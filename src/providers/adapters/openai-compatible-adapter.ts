import { ProviderError } from "../../shared/errors";
import { logger as log } from "../../shared/logger";
import { type Result, err, ok } from "../../shared/result";
/**
 * OpenAI-compatible LLM provider adapter.
 * Works with any provider that implements the OpenAI chat completions API.
 */
import type {
  ChatRequest,
  ChatResponse,
  LLMProvider,
  ModelInfo,
  StreamChunk,
  TokenUsage,
  ToolCall,
} from "../../shared/types";

export type OpenAICompatibleConfig = {
  name: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  defaultModel?: string;
  timeoutMs?: number;
};

export function createOpenAICompatibleAdapter(config: OpenAICompatibleConfig): LLMProvider {
  const { name, baseUrl, apiKey, headers: extraHeaders = {}, timeoutMs = 60_000 } = config;

  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (apiKey) {
    baseHeaders.Authorization = `Bearer ${apiKey}`;
  }

  function buildRequestBody(request: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: buildMessages(request),
    };
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }
    if (request.stream) body.stream = true;
    return body;
  }

  function buildMessages(
    request: ChatRequest,
  ): Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: ToolCall[] }> {
    const messages: Array<{
      role: string;
      content: string;
      tool_call_id?: string;
      tool_calls?: ToolCall[];
    }> = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    for (const msg of request.messages) {
      const m: Record<string, unknown> = { role: msg.role, content: msg.content };
      if (msg.tool_call_id) m.tool_call_id = msg.tool_call_id;
      if (msg.tool_calls) m.tool_calls = msg.tool_calls;
      messages.push(m as { role: string; content: string });
    }
    return messages;
  }

  function parseResponse(data: Record<string, unknown>): ChatResponse {
    const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
    const message = choice?.message as Record<string, unknown> | undefined;
    const usage = data.usage as Record<string, number> | undefined;

    const toolCalls = (message?.tool_calls as Array<Record<string, unknown>>)?.map((tc) => ({
      id: tc.id as string,
      type: "function" as const,
      function: tc.function as { name: string; arguments: string },
    }));

    const finishReason = mapFinishReason(choice?.finish_reason as string);

    return {
      id: data.id as string,
      model: data.model as string,
      content: (message?.content as string) ?? "",
      usage: {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
      },
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      finishReason,
    };
  }

  function mapFinishReason(reason: string | undefined): ChatResponse["finishReason"] {
    switch (reason) {
      case "stop":
        return "stop";
      case "tool_calls":
        return "tool_calls";
      case "length":
        return "length";
      default:
        return "stop";
    }
  }

  function makeProviderError(message: string, statusCode?: number): ProviderError {
    let code: ProviderError["code"] = "API_ERROR";
    if (statusCode === 401 || statusCode === 403) code = "AUTH_ERROR";
    else if (statusCode === 429) code = "RATE_LIMIT";
    else if (statusCode === 404) code = "NOT_FOUND";
    else if (statusCode === 408) code = "TIMEOUT";

    return new ProviderError(message, code, statusCode, name);
  }

  async function chat(request: ChatRequest): Promise<Result<ChatResponse>> {
    const url = `${baseUrl}/chat/completions`;
    const body = buildRequestBody({ ...request, stream: false });

    log.debug("chat request", { url, model: request.model });

    try {
      const signals = [AbortSignal.timeout(timeoutMs)];
      if (request.signal) signals.push(request.signal);
      const combinedSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

      const response = await fetch(url, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(body),
        signal: combinedSignal,
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
      if (e instanceof Error && e.name === "AbortError") {
        return err(new ProviderError("Request aborted", "TIMEOUT", 499, name));
      }
      if (e instanceof Error && e.name === "TimeoutError") {
        return err(new ProviderError("Request timed out", "TIMEOUT", 408, name));
      }
      return err(makeProviderError(e instanceof Error ? e.message : String(e)));
    }
  }

  async function* stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const url = `${baseUrl}/chat/completions`;
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
      yield {
        type: "error",
        error: e instanceof Error ? e.message : String(e),
      };
      return;
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      yield {
        type: "error",
        error: `${response.status} ${response.statusText}: ${errorBody}`,
      };
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

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (!trimmed.startsWith("data: ")) continue;

          const payload = trimmed.slice(6);
          if (payload === "[DONE]") {
            yield { type: "done" };
            return;
          }

          try {
            const data = JSON.parse(payload) as Record<string, unknown>;
            const chunk = parseStreamChunk(data);
            if (chunk) yield chunk;
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
      yield { type: "done" };
    } finally {
      reader.releaseLock();
    }
  }

  function parseStreamChunk(data: Record<string, unknown>): StreamChunk | null {
    const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
    if (!choice) return null;

    const delta = choice.delta as Record<string, unknown> | undefined;
    if (!delta) return null;

    // Tool call delta
    const toolCallDeltas = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCallDeltas?.length) {
      const tc = toolCallDeltas[0] as Record<string, unknown> | undefined;
      if (!tc) return null;
      const fn = tc.function as Record<string, string> | undefined;
      return {
        type: "tool_call",
        toolCall: {
          id: (tc.id as string) ?? "",
          type: "function",
          function: {
            name: fn?.name ?? "",
            arguments: fn?.arguments ?? "",
          },
        },
      };
    }

    // Content delta
    const content = delta.content as string | undefined;
    if (content !== undefined && content !== null) {
      return { type: "content", delta: content };
    }

    // Usage (some providers send this on the final chunk)
    const usage = data.usage as Record<string, number> | undefined;
    if (usage && choice.finish_reason) {
      return {
        type: "done",
        usage: {
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          totalTokens: usage.total_tokens ?? 0,
        },
      };
    }

    return null;
  }

  async function listModels(): Promise<Result<ModelInfo[]>> {
    const url = `${baseUrl}/models`;
    log.debug("listing models", { url });

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: baseHeaders,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        return err(makeProviderError(`Failed to list models: ${response.status}`, response.status));
      }

      const data = (await response.json()) as { data?: Array<Record<string, unknown>> };
      const models: ModelInfo[] = (data.data ?? []).map((m) => ({
        id: m.id as string,
        name: (m.name as string) ?? (m.id as string),
        provider: name,
        contextWindow: m.context_length as number | undefined,
      }));

      return ok(models);
    } catch (e) {
      return err(makeProviderError(e instanceof Error ? e.message : String(e)));
    }
  }

  async function healthCheck(): Promise<Result<boolean>> {
    const url = `${baseUrl}/models`;
    log.debug("health check", { url });

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: baseHeaders,
        signal: AbortSignal.timeout(5_000),
      });

      return ok(response.ok);
    } catch {
      return ok(false);
    }
  }

  return { name, chat, stream, listModels, healthCheck };
}
