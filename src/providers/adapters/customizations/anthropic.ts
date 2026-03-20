/**
 * Anthropic provider protocol.
 *
 * Anthropic's Messages API differs substantially from the OpenAI-compatible
 * standard: different endpoint, headers, message format, tool calling
 * conventions, streaming events, and usage field names.
 */

import { ProviderError } from "../../../shared/errors";
import { type Result, err, ok } from "../../../shared/result";
import type {
  ChatRequest,
  ChatResponse,
  ModelInfo,
  StreamChunk,
} from "../../../shared/types";
import type { ProtocolContext, ProviderProtocol } from "../provider-protocol";

const ANTHROPIC_API_VERSION = "2023-06-01";

function buildHeaders(apiKey?: string, extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_API_VERSION,
    ...extraHeaders,
  };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

type AnthropicContent = string | Array<Record<string, unknown>>;
type AnthropicMessage = { role: "user" | "assistant"; content: AnthropicContent };

function buildRequestBody(request: ChatRequest): Record<string, unknown> {
  const messages: AnthropicMessage[] = [];

  for (const msg of request.messages) {
    if (msg.role === "system") continue; // handled separately

    if (msg.role === "assistant") {
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

async function listModels(ctx: ProtocolContext): Promise<Result<ModelInfo[]>> {
  // Anthropic doesn't have a models endpoint, return known models
  const models: ModelInfo[] = [
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: ctx.providerName, contextWindow: 200_000 },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: ctx.providerName, contextWindow: 200_000 },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: ctx.providerName, contextWindow: 200_000 },
  ];
  return ok(models);
}

async function healthCheck(ctx: ProtocolContext): Promise<Result<boolean>> {
  try {
    const response = await fetch(`${ctx.baseUrl}/messages`, {
      method: "POST",
      headers: ctx.headers,
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

export const anthropicProtocol: ProviderProtocol = {
  chatPath: "/messages",
  buildHeaders,
  buildRequestBody,
  parseResponse,
  parseStreamEvent,
  listModels,
  healthCheck,
  extraErrorCodes: { 529: "TIMEOUT" },
  requiresApiKey: true,
};
