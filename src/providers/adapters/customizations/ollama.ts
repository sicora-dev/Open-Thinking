/**
 * Ollama provider protocol.
 *
 * Ollama exposes an OpenAI-compatible API at /v1, so it reuses the default
 * protocol for chat/streaming. The differences are:
 * - Model listing uses Ollama's native /api/tags endpoint
 * - Health check hits the root endpoint
 * - No API key needed
 */

import { ProviderError } from "../../../shared/errors";
import { logger as log } from "../../../shared/logger";
import { type Result, err, ok } from "../../../shared/result";
import type { ModelInfo } from "../../../shared/types";
import type { ProtocolContext, ProviderProtocol } from "../provider-protocol";
import { defaultProtocol } from "./default";

async function listModels(ctx: ProtocolContext): Promise<Result<ModelInfo[]>> {
  // Ollama's base URL for the adapter has /v1 appended, strip it for native API
  const ollamaBaseUrl = ctx.baseUrl.replace(/\/v1$/, "");
  const url = `${ollamaBaseUrl}/api/tags`;
  log.debug("listing ollama models", { url });

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
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

    const data = (await response.json()) as {
      models?: Array<{ name: string; details?: Record<string, unknown> }>;
    };

    const models: ModelInfo[] = (data.models ?? []).map((m) => ({
      id: m.name,
      name: m.name,
      provider: ctx.providerName,
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
  const ollamaBaseUrl = ctx.baseUrl.replace(/\/v1$/, "");
  try {
    const response = await fetch(ollamaBaseUrl, {
      signal: AbortSignal.timeout(5_000),
    });
    return ok(response.ok);
  } catch {
    return ok(false);
  }
}

export const ollamaProtocol: ProviderProtocol = {
  ...defaultProtocol,
  listModels,
  healthCheck,
};
