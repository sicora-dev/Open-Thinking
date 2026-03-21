/**
 * Base LLM adapter.
 *
 * Handles all HTTP plumbing shared across providers: fetch with timeouts,
 * abort signal management, SSE streaming, error mapping, automatic retries
 * with exponential backoff, and rate limiting via token bucket.
 *
 * Every provider-specific decision is delegated to a ProviderProtocol.
 */

import { ProviderError } from "../../shared/errors";
import { logger as log } from "../../shared/logger";
import { type Result, err, ok } from "../../shared/result";
import type {
  ChatRequest,
  ChatResponse,
  LLMProvider,
  ModelInfo,
  StreamChunk,
} from "../../shared/types";
import {
  type AttemptResult,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
  getRateLimiter,
  getTpmLimiter,
  isRetriableNetworkError,
  isRetriableStatus,
  withRetry,
} from "../resilience";
import type { ProviderProtocol } from "./provider-protocol";

export type BaseAdapterConfig = {
  name: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Override retry behavior. Set maxRetries: 0 to disable retries. */
  retryConfig?: Partial<RetryConfig>;
  /** Requests per minute limit. Overrides the provider catalog default. */
  rateLimitRpm?: number;
  /** Tokens per minute limit. Overrides the provider catalog default. Self-calibrates from response headers. */
  rateLimitTpm?: number;
  protocol: ProviderProtocol;
};

export function createAdapter(config: BaseAdapterConfig): LLMProvider {
  const {
    name,
    baseUrl,
    apiKey,
    headers: extraHeaders,
    timeoutMs = 120_000,
    retryConfig,
    rateLimitRpm,
    rateLimitTpm,
    protocol,
  } = config;

  const baseHeaders = protocol.buildHeaders(apiKey, extraHeaders);
  const rateLimiter = getRateLimiter(name, rateLimitRpm);
  const tpmLimiter = getTpmLimiter(name, rateLimitTpm);

  function mapErrorCode(statusCode: number): ProviderError["code"] {
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

  // ─── chat (non-streaming) ─────────────────────────────────

  async function chat(request: ChatRequest): Promise<Result<ChatResponse>> {
    const url = `${baseUrl}${protocol.chatPath}`;
    const body = protocol.buildRequestBody({ ...request, stream: false });
    const bodyJson = JSON.stringify(body);
    const signal = buildSignal(request);

    // Estimate input tokens from payload size (~4 chars per token)
    const estimatedTokens = Math.ceil(bodyJson.length / 4);

    log.debug("chat request", { url, model: request.model, estimatedTokens });

    const result = await withRetry<ChatResponse>(
      async (): Promise<AttemptResult<ChatResponse>> => {
        // Wait for RPM and TPM limiters before each attempt
        await rateLimiter.acquire(signal);
        await tpmLimiter.acquire(estimatedTokens, signal);

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: baseHeaders,
            body: bodyJson,
            signal,
          });

          if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            const retriable = isRetriableStatus(response.status);
            // Calibrate TPM limit from error response headers too
            tpmLimiter.updateFromHeaders(response.headers);
            return {
              ok: false,
              retriable,
              error: makeProviderError(
                `${response.status} ${response.statusText}: ${errorBody}`,
                response.status,
              ),
              responseMeta: { status: response.status, headers: response.headers },
            };
          }

          // Calibrate TPM limit from response headers
          tpmLimiter.updateFromHeaders(response.headers);

          const data = (await response.json()) as Record<string, unknown>;
          const parsed = protocol.parseResponse(data);

          // Record actual token usage for TPM tracking
          tpmLimiter.record(parsed.usage.totalTokens);

          return { ok: true, value: parsed };
        } catch (e) {
          if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) {
            return {
              ok: false,
              retriable: false,
              error: new ProviderError(
                e.name === "AbortError" ? "Request aborted" : "Request timed out",
                "TIMEOUT",
                e.name === "AbortError" ? 499 : 408,
                name,
              ),
            };
          }
          return {
            ok: false,
            retriable: isRetriableNetworkError(e),
            error: makeProviderError(e instanceof Error ? e.message : String(e)),
          };
        }
      },
      retryConfig,
      signal,
    );

    if (result.ok) return ok(result.value);
    return err(
      result.error instanceof ProviderError
        ? result.error
        : makeProviderError(result.error.message),
    );
  }

  // ─── stream (SSE) ─────────────────────────────────────────

  async function* stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const url = `${baseUrl}${protocol.chatPath}`;
    const body = protocol.buildRequestBody({ ...request, stream: true });
    const bodyJson = JSON.stringify(body);
    const signal = buildSignal(request);
    const estimatedTokens = Math.ceil(bodyJson.length / 4);

    log.debug("stream request", { url, model: request.model, estimatedTokens });

    // Retry only the initial connection, not mid-stream failures
    const connResult = await withRetry<Response>(
      async (): Promise<AttemptResult<Response>> => {
        await rateLimiter.acquire(signal);
        await tpmLimiter.acquire(estimatedTokens, signal);

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: baseHeaders,
            body: bodyJson,
            signal,
          });

          if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            return {
              ok: false,
              retriable: isRetriableStatus(response.status),
              error: makeProviderError(
                `${response.status} ${response.statusText}: ${errorBody}`,
                response.status,
              ),
              responseMeta: { status: response.status, headers: response.headers },
            };
          }

          return { ok: true, value: response };
        } catch (e) {
          if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) {
            return { ok: false, retriable: false, error: e };
          }
          return {
            ok: false,
            retriable: isRetriableNetworkError(e),
            error: e instanceof Error ? e : new Error(String(e)),
          };
        }
      },
      retryConfig,
      signal,
    );

    if (!connResult.ok) {
      yield { type: "error", error: connResult.error.message };
      return;
    }

    const response = connResult.value;

    // Calibrate TPM limit from the connection response headers
    tpmLimiter.updateFromHeaders(response.headers);

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

          if (trimmed.startsWith("event: ")) {
            currentEvent = trimmed.slice(7);
            continue;
          }

          if (!trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);

          if (payload === "[DONE]") {
            yield { type: "done" };
            return;
          }

          try {
            const data = JSON.parse(payload) as Record<string, unknown>;
            const chunk = protocol.parseStreamEvent(currentEvent, data);
            if (chunk) {
              // Record token usage from the final chunk (providers send it with the last event)
              if (chunk.usage) {
                tpmLimiter.record(chunk.usage.totalTokens);
              }
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

  // ─── utility endpoints ────────────────────────────────────

  const ctx = { baseUrl, headers: baseHeaders, timeoutMs, providerName: name };

  async function listModels(): Promise<Result<ModelInfo[]>> {
    return protocol.listModels(ctx);
  }

  async function healthCheck(): Promise<Result<boolean>> {
    return protocol.healthCheck(ctx);
  }

  return { name, chat, stream, listModels, healthCheck };
}
