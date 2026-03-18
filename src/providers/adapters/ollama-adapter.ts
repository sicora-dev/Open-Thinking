import { ProviderError } from "../../shared/errors";
import { logger as log } from "../../shared/logger";
import { type Result, err, ok } from "../../shared/result";
/**
 * Ollama provider adapter.
 * Wraps the OpenAI-compatible adapter with Ollama-specific defaults.
 * Ollama exposes an OpenAI-compatible API at /v1/.
 */
import type { LLMProvider, ModelInfo } from "../../shared/types";
import { createOpenAICompatibleAdapter } from "./openai-compatible-adapter";

const DEFAULT_BASE_URL = "http://localhost:11434";

export type OllamaConfig = {
  name: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
};

export function createOllamaAdapter(config: OllamaConfig): LLMProvider {
  const { name, baseUrl = DEFAULT_BASE_URL, defaultModel, timeoutMs = 120_000 } = config;

  // Ollama provides an OpenAI-compatible API at /v1
  const inner = createOpenAICompatibleAdapter({
    name,
    baseUrl: `${baseUrl}/v1`,
    defaultModel,
    timeoutMs,
  });

  // Override listModels to use Ollama's native API for richer info
  async function listModels(): Promise<Result<ModelInfo[]>> {
    const url = `${baseUrl}/api/tags`;
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
            name,
          ),
        );
      }

      const data = (await response.json()) as {
        models?: Array<{ name: string; details?: Record<string, unknown> }>;
      };

      const models: ModelInfo[] = (data.models ?? []).map((m) => ({
        id: m.name,
        name: m.name,
        provider: name,
      }));

      return ok(models);
    } catch (e) {
      return err(
        new ProviderError(e instanceof Error ? e.message : String(e), "API_ERROR", undefined, name),
      );
    }
  }

  // Override healthCheck to hit Ollama's root endpoint
  async function healthCheck(): Promise<Result<boolean>> {
    try {
      const response = await fetch(baseUrl, {
        signal: AbortSignal.timeout(5_000),
      });
      return ok(response.ok);
    } catch {
      return ok(false);
    }
  }

  return {
    name,
    chat: inner.chat,
    stream: inner.stream,
    listModels,
    healthCheck,
  };
}
