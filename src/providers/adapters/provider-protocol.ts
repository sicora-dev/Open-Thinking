/**
 * Provider protocol definition.
 *
 * Each LLM provider speaks a different dialect of a chat API. A ProviderProtocol
 * defines the complete translation layer for one provider: how to build requests,
 * parse responses, handle streaming, list models, and check health.
 *
 * The base adapter (`base-adapter.ts`) handles all the HTTP plumbing — fetch,
 * timeouts, abort signals, SSE line parsing, error mapping. It delegates every
 * provider-specific decision to the protocol.
 *
 * To add a new provider, create a file in `customizations/` that exports a
 * ProviderProtocol object.
 */

import type { ChatRequest, ChatResponse, ModelInfo, StreamChunk } from "../../shared/types";
import type { Result } from "../../shared/result";

/**
 * Context passed to protocol functions that need to make HTTP requests
 * (e.g., model listing, health checks).
 */
export type ProtocolContext = {
  baseUrl: string;
  headers: Record<string, string>;
  timeoutMs: number;
  providerName: string;
};

export type ProviderProtocol = {
  /** Endpoint path appended to baseUrl for chat requests (e.g., "/chat/completions", "/messages"). */
  chatPath: string;

  /** Build HTTP headers. Called once at adapter creation time. */
  buildHeaders: (apiKey?: string, extraHeaders?: Record<string, string>) => Record<string, string>;

  /** Translate a ChatRequest into the provider's request body format. */
  buildRequestBody: (request: ChatRequest) => Record<string, unknown>;

  /** Translate the provider's response JSON into a ChatResponse. */
  parseResponse: (data: Record<string, unknown>) => ChatResponse;

  /**
   * Parse a single SSE event into a StreamChunk.
   * @param event - The SSE event name (empty string if the provider doesn't use event types).
   * @param data - The parsed JSON payload from the `data:` line.
   * @returns A StreamChunk, or null to skip this event.
   */
  parseStreamEvent: (event: string, data: Record<string, unknown>) => StreamChunk | null;

  /** List available models for this provider. */
  listModels: (ctx: ProtocolContext) => Promise<Result<ModelInfo[]>>;

  /** Check if the provider is reachable and authenticated. */
  healthCheck: (ctx: ProtocolContext) => Promise<Result<boolean>>;

  /**
   * Additional status codes to map to specific error types.
   * Merged with the base adapter's default mapping (401/403→AUTH, 429→RATE_LIMIT, etc.).
   */
  extraErrorCodes?: Record<number, "AUTH_ERROR" | "RATE_LIMIT" | "TIMEOUT" | "NOT_FOUND" | "API_ERROR">;

  /** Whether this provider requires an API key. Checked by the factory before creating the adapter. */
  requiresApiKey?: boolean;
};
