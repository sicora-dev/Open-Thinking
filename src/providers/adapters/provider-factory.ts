import { ProviderError } from "../../shared/errors";
import { type Result, err, ok } from "../../shared/result";
/**
 * Factory that creates an LLMProvider from a resolved provider config.
 * The config is already resolved from the provider catalog and global keys
 * by the pipeline parser — this factory just instantiates the right adapter.
 */
import type { LLMProvider, ResolvedProvider } from "../../shared/types";
import { createAnthropicAdapter } from "./anthropic-adapter";
import { createOllamaAdapter } from "./ollama-adapter";
import { createOpenAICompatibleAdapter } from "./openai-compatible-adapter";

export function createProviderFromConfig(
  name: string,
  config: ResolvedProvider,
): Result<LLMProvider> {
  switch (config.type) {
    case "openai-compatible": {
      // Detect Anthropic by base_url
      if (config.base_url.includes("anthropic.com")) {
        if (!config.api_key) {
          return err(
            new ProviderError(
              `Anthropic provider "${name}" requires an api_key`,
              "AUTH_ERROR",
              undefined,
              name,
            ),
          );
        }
        return ok(
          createAnthropicAdapter({
            name,
            apiKey: config.api_key,
            baseUrl: config.base_url,
          }),
        );
      }

      return ok(
        createOpenAICompatibleAdapter({
          name,
          baseUrl: config.base_url,
          apiKey: config.api_key,
          headers: config.headers,
        }),
      );
    }

    case "ollama":
      return ok(
        createOllamaAdapter({
          name,
          baseUrl: config.base_url,
        }),
      );

    case "custom":
      // Custom providers use the OpenAI-compatible adapter with custom headers
      return ok(
        createOpenAICompatibleAdapter({
          name,
          baseUrl: config.base_url,
          apiKey: config.api_key,
          headers: config.headers,
        }),
      );

    default:
      return err(
        new ProviderError(`Unknown provider type: ${config.type}`, "NOT_FOUND", undefined, name),
      );
  }
}
