/**
 * Base LLM adapter.
 *
 * Handles all HTTP plumbing shared across providers: fetch with timeouts,
 * abort signal management, SSE streaming, and error mapping.
 * Every provider-specific decision is delegated to a ProviderProtocol.
 */

import { ProviderError } from "../../shared/errors";
import { logger as log } from "../../shared/logger";
import { type Result, err, ok } from "../../shared/result";
import type { ChatRequest, ChatResponse, LLMProvider, ModelInfo, StreamChunk } from "../../shared/types";
import type { ProviderProtocol } from "./provider-protocol";

export type BaseAdapterConfig = {
  name: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  protocol: ProviderProtocol;
};

export function createAdapter(config: BaseAdapterConfig): LLMProvider {
  const { name, baseUrl, apiKey, headers: extraHeaders, timeoutMs = 120_000, protocol } = config;

  const baseHeaders = protocol.buildHeaders(apiKey, extraHeaders);

  function mapErrorCode(statusCode: number): ProviderError["code"] {
    // Check provider-specific codes first
    if (protocol.extraErrorCodes?.[statusCode]) {
      return protocol.extraErrorCodes[statusCode];
    }
    if (statusCode === 401 || statusCode === 403) return "AUTH_ERROR";
    if (statusCode === 429) return "RATE_LIMIT";
    if (statusCode === 404) return "NOT_FOUND";
    if (statusCode === 408) return "TIMEOUT";
    return "API_ERROR";
  }

  function makeProviderError(message: string, statusCode?: number): ProviderError {
    const code = statusCode ? mapErrorCode(statusCode) : "API_ERROR";
    return new ProviderError(message, code, statusCode, name);
  }

  function buildSignal(request: ChatRequest): AbortSignal {
    const effectiveTimeout = request.timeoutMs ?? timeoutMs;
    const timeoutSignal = AbortSignal.timeout(effectiveTimeout);
    if (request.signal) {
      return AbortSignal.any([timeoutSignal, request.signal]);
    }
    return timeoutSignal;
  }

  async function chat(request: ChatRequest): Promise<Result<ChatResponse>> {
    const url = `${baseUrl}${protocol.chatPath}`;
    const body = protocol.buildRequestBody({ ...request, stream: false });

    log.debug("chat request", { url, model: request.model });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(body),
        signal: buildSignal(request),
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
      return ok(protocol.parseResponse(data));
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
    const url = `${baseUrl}${protocol.chatPath}`;
    const body = protocol.buildRequestBody({ ...request, stream: true });

    log.debug("stream request", { url, model: request.model });

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(body),
        signal: buildSignal(request),
      });
    } catch (e) {
      yield { type: "error", error: e instanceof Error ? e.message : String(e) };
      return;
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      yield { type: "error", error: `${response.status} ${response.statusText}: ${errorBody}` };
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
          if (!trimmed || trimmed.startsWith(":")) continue;

          // Track SSE event types (used by Anthropic, ignored by OpenAI-like providers)
          if (trimmed.startsWith("event: ")) {
            currentEvent = trimmed.slice(7);
            continue;
          }

          if (!trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);

          // Universal stream terminator (OpenAI-style)
          if (payload === "[DONE]") {
            yield { type: "done" };
            return;
          }

          try {
            const data = JSON.parse(payload) as Record<string, unknown>;
            const chunk = protocol.parseStreamEvent(currentEvent, data);
            if (chunk) {
              yield chunk;
              if (chunk.type === "done") return;
            }
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

  const ctx = { baseUrl, headers: baseHeaders, timeoutMs, providerName: name };

  async function listModels(): Promise<Result<ModelInfo[]>> {
    return protocol.listModels(ctx);
  }

  async function healthCheck(): Promise<Result<boolean>> {
    return protocol.healthCheck(ctx);
  }

  return { name, chat, stream, listModels, healthCheck };
}
