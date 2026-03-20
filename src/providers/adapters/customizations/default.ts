/**
 * Default provider protocol.
 *
 * Standard OpenAI-compatible chat completions API. Used by providers that
 * fully implement the OpenAI spec without deviations: Groq, Together,
 * Fireworks, Mistral, DeepSeek, OpenRouter, etc.
 *
 * Providers with API differences should create their own protocol file
 * and override only what changes.
 */

import { ProviderError } from "../../../shared/errors";
import { logger as log } from "../../../shared/logger";
import { type Result, err, ok } from "../../../shared/result";
import type {
  ChatRequest,
  ChatResponse,
  ModelInfo,
  StreamChunk,
  ToolCall,
} from "../../../shared/types";
import type { ProtocolContext, ProviderProtocol } from "../provider-protocol";

function buildHeaders(apiKey?: string, extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function buildRequestBody(request: ChatRequest): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];
  if (request.systemPrompt) {
    messages.push({ role: "system", content: request.systemPrompt });
  }
  for (const msg of request.messages) {
    const m: Record<string, unknown> = { role: msg.role, content: msg.content };
    if (msg.tool_call_id) m.tool_call_id = msg.tool_call_id;
    if (msg.tool_calls) m.tool_calls = msg.tool_calls;
    messages.push(m);
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages,
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

function parseResponse(data: Record<string, unknown>): ChatResponse {
  const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  const usage = data.usage as Record<string, number> | undefined;

  const toolCalls = (message?.tool_calls as Array<Record<string, unknown>>)?.map((tc) => ({
    id: tc.id as string,
    type: "function" as const,
    function: tc.function as { name: string; arguments: string },
  }));

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
    finishReason: mapFinishReason(choice?.finish_reason as string),
  };
}

function parseStreamEvent(_event: string, data: Record<string, unknown>): StreamChunk | null {
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

async function listModels(ctx: ProtocolContext): Promise<Result<ModelInfo[]>> {
  const url = `${ctx.baseUrl}/models`;
  log.debug("listing models", { url });

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: ctx.headers,
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });

    if (!response.ok) {
      return err(
        new ProviderError(
          `Failed to list models: ${response.status}`,
          "API_ERROR",
          response.status,
          ctx.providerName,
        ),
      );
    }

    const data = (await response.json()) as { data?: Array<Record<string, unknown>> };
    const models: ModelInfo[] = (data.data ?? []).map((m) => ({
      id: m.id as string,
      name: (m.name as string) ?? (m.id as string),
      provider: ctx.providerName,
      contextWindow: m.context_length as number | undefined,
    }));

    return ok(models);
  } catch (e) {
    return err(
      new ProviderError(
        e instanceof Error ? e.message : String(e),
        "API_ERROR",
        undefined,
        ctx.providerName,
      ),
    );
  }
}

async function healthCheck(ctx: ProtocolContext): Promise<Result<boolean>> {
  const url = `${ctx.baseUrl}/models`;
  log.debug("health check", { url });

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: ctx.headers,
      signal: AbortSignal.timeout(5_000),
    });
    return ok(response.ok);
  } catch {
    return ok(false);
  }
}

export const defaultProtocol: ProviderProtocol = {
  chatPath: "/chat/completions",
  buildHeaders,
  buildRequestBody,
  parseResponse,
  parseStreamEvent,
  listModels,
  healthCheck,
};
