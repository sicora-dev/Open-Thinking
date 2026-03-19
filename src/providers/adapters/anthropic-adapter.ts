import { ProviderError } from "../../shared/errors";
import { logger as log } from "../../shared/logger";
import { type Result, err, ok } from "../../shared/result";
/**
 * Anthropic provider adapter.
 * Translates the OpenAI-compatible interface to Anthropic's Messages API.
 */
import type {
  ChatRequest,
  ChatResponse,
  LLMProvider,
  ModelInfo,
  StreamChunk,
} from "../../shared/types";

const ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";

export type AnthropicConfig = {
  name: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
};

export function createAnthropicAdapter(config: AnthropicConfig): LLMProvider {
  const { name, apiKey, baseUrl = DEFAULT_BASE_URL, timeoutMs = 120_000 } = config;

  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_API_VERSION,
  };

  type AnthropicContent = string | Array<Record<string, unknown>>;
  type AnthropicMessage = { role: "user" | "assistant"; content: AnthropicContent };

  function buildRequestBody(request: ChatRequest): Record<string, unknown> {
    const messages: AnthropicMessage[] = [];

    for (const msg of request.messages) {
      if (msg.role === "system") continue; // handled separately

      if (msg.role === "assistant") {
        // If assistant has tool_calls, convert to Anthropic content blocks
        if (msg.tool_calls?.length) {
          const blocks: Array<Record<string, unknown>> = [];
          if (msg.content) blocks.push({ type: "text", text: msg.content });
          for (const tc of msg.tool_calls) {
            blocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            });
          }
          messages.push({ role: "assistant", content: blocks });
        } else {
          messages.push({ role: "assistant", content: msg.content });
        }
      } else if (msg.role === "tool") {
        // Anthropic expects tool results as user messages with tool_result blocks
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.tool_call_id,
              content: msg.content,
            },
          ],
        });
      } else if (msg.role === "user") {
        messages.push({ role: "user", content: msg.content });
      }
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? 4096,
    };

    // Combine system prompts
    const systemParts: string[] = [];
    if (request.systemPrompt) systemParts.push(request.systemPrompt);
    for (const msg of request.messages) {
      if (msg.role === "system") systemParts.push(msg.content);
    }
    if (systemParts.length) body.system = systemParts.join("\n\n");

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }
    if (request.stream) body.stream = true;

    return body;
  }

  function makeProviderError(message: string, statusCode?: number): ProviderError {
    let code: ProviderError["code"] = "API_ERROR";
    if (statusCode === 401 || statusCode === 403) code = "AUTH_ERROR";
    else if (statusCode === 429) code = "RATE_LIMIT";
    else if (statusCode === 404) code = "NOT_FOUND";
    else if (statusCode === 408 || statusCode === 529) code = "TIMEOUT";
    return new ProviderError(message, code, statusCode, name);
  }

  async function chat(request: ChatRequest): Promise<Result<ChatResponse>> {
    const url = `${baseUrl}/messages`;
    const body = buildRequestBody({ ...request, stream: false });

    log.debug("chat request", { url, model: request.model });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        return err(
          makeProviderError(
            `${response.status} ${response.statusText}: ${errorBody}`,
            response.status,
          ),
        );
      }

      const data = (await response.json()) as Record<string, unknown>;
      return ok(parseResponse(data));
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        return err(new ProviderError("Request timed out", "TIMEOUT", 408, name));
      }
      return err(makeProviderError(e instanceof Error ? e.message : String(e)));
    }
  }

  function parseResponse(data: Record<string, unknown>): ChatResponse {
    const content = data.content as Array<Record<string, unknown>>;
    const usage = data.usage as Record<string, number>;

    let textContent = "";
    const toolCalls: ChatResponse["toolCalls"] = [];

    for (const block of content ?? []) {
      if (block.type === "text") {
        textContent += block.text as string;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id as string,
          type: "function",
          function: {
            name: block.name as string,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    const stopReason = data.stop_reason as string;
    let finishReason: ChatResponse["finishReason"] = "stop";
    if (stopReason === "tool_use") finishReason = "tool_calls";
    else if (stopReason === "max_tokens") finishReason = "length";

    return {
      id: data.id as string,
      model: data.model as string,
      content: textContent,
      usage: {
        promptTokens: usage?.input_tokens ?? 0,
        completionTokens: usage?.output_tokens ?? 0,
        totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
      },
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finishReason,
    };
  }

  async function* stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const url = `${baseUrl}/messages`;
    const body = buildRequestBody({ ...request, stream: true });

    log.debug("stream request", { url, model: request.model });

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      yield { type: "error", error: e instanceof Error ? e.message : String(e) };
      return;
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      yield { type: "error", error: `${response.status}: ${errorBody}` };
      return;
    }

    if (!response.body) {
      yield { type: "error", error: "No response body for streaming" };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith("event: ")) {
            currentEvent = trimmed.slice(7);
            continue;
          }

          if (!trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);

          try {
            const data = JSON.parse(payload) as Record<string, unknown>;
            const chunk = parseStreamEvent(currentEvent, data);
            if (chunk) yield chunk;
          } catch {
            // Skip malformed JSON
          }
        }
      }
      yield { type: "done" };
    } finally {
      reader.releaseLock();
    }
  }

  function parseStreamEvent(event: string, data: Record<string, unknown>): StreamChunk | null {
    switch (event) {
      case "content_block_delta": {
        const delta = data.delta as Record<string, unknown>;
        if (delta?.type === "text_delta") {
          return { type: "content", delta: delta.text as string };
        }
        if (delta?.type === "input_json_delta") {
          return {
            type: "tool_call",
            toolCall: {
              id: "",
              type: "function",
              function: { name: "", arguments: delta.partial_json as string },
            },
          };
        }
        return null;
      }
      case "content_block_start": {
        const block = data.content_block as Record<string, unknown>;
        if (block?.type === "tool_use") {
          return {
            type: "tool_call",
            toolCall: {
              id: block.id as string,
              type: "function",
              function: { name: block.name as string, arguments: "" },
            },
          };
        }
        return null;
      }
      case "message_delta": {
        const usage = data.usage as Record<string, number> | undefined;
        if (usage) {
          return {
            type: "done",
            usage: {
              promptTokens: 0,
              completionTokens: usage.output_tokens ?? 0,
              totalTokens: usage.output_tokens ?? 0,
            },
          };
        }
        return null;
      }
      case "message_stop":
        return { type: "done" };
      case "error":
        return { type: "error", error: JSON.stringify(data) };
      default:
        return null;
    }
  }

  async function listModels(): Promise<Result<ModelInfo[]>> {
    // Anthropic doesn't have a models endpoint, return known models
    const models: ModelInfo[] = [
      { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: name, contextWindow: 200_000 },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        provider: name,
        contextWindow: 200_000,
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        provider: name,
        contextWindow: 200_000,
      },
    ];
    return ok(models);
  }

  async function healthCheck(): Promise<Result<boolean>> {
    // Validate key by attempting a minimal request
    try {
      const response = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      // 200 or 400 (bad request but auth works) both count as healthy
      return ok(response.status !== 401 && response.status !== 403);
    } catch {
      return ok(false);
    }
  }

  return { name, chat, stream, listModels, healthCheck };
}
