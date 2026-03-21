import { ProviderError } from "../../shared/errors";
import { type Result, err, ok } from "../../shared/result";
/**
 * Factory that creates an LLMProvider from a resolved provider config.
 * The config is already resolved from the provider catalog and global keys
 * by the pipeline parser — this factory just instantiates the right adapter.
 *
 * All providers use the same base adapter. The protocol registry determines
 * how each provider's API is translated.
 */
import type { LLMProvider, ResolvedProvider } from "../../shared/types";
import { createAdapter } from "./base-adapter";
import { getProtocol } from "./customizations";

export function createProviderFromConfig(
  name: string,
  config: ResolvedProvider,
): Result<LLMProvider> {
  const protocol = getProtocol(name);

  if (protocol.requiresApiKey && !config.api_key) {
    return err(
      new ProviderError(`Provider "${name}" requires an api_key`, "AUTH_ERROR", undefined, name),
    );
  }

  // Ollama uses /v1 sub-path for OpenAI compatibility
  const baseUrl = config.type === "ollama" ? `${config.base_url}/v1` : config.base_url;

  return ok(
    createAdapter({
      name,
      baseUrl,
      apiKey: config.api_key,
      headers: config.headers,
      rateLimitRpm: config.rate_limit_rpm,
      protocol,
    }),
  );
}
