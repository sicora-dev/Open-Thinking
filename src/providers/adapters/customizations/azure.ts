/**
 * Azure OpenAI provider protocol.
 *
 * The current v1 API uses an OpenAI-compatible base URL ending in
 * /openai/v1 and keeps the model/deployment name in the request body.
 * Legacy deployment URLs are still supported for existing configs.
 */

import { ProviderError } from "../../../shared/errors";
import { type Result, err, ok } from "../../../shared/result";
import type { ChatRequest, ModelInfo } from "../../../shared/types";
import type { ProtocolContext, ProviderProtocol } from "../provider-protocol";
import { defaultProtocol } from "./default";

function buildHeaders(apiKey?: string, extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (apiKey) headers["api-key"] = apiKey;
  return headers;
}

function buildRequestBody(request: ChatRequest): Record<string, unknown> {
  const body = defaultProtocol.buildRequestBody(request);
  delete body.model;
  return body;
}

const azureV1Protocol: ProviderProtocol = {
  ...defaultProtocol,
  buildHeaders,
  requiresApiKey: true,
};

async function listModels(ctx: ProtocolContext): Promise<Result<ModelInfo[]>> {
  const check = await healthCheck(ctx);
  if (!check.ok) return err(check.error);
  if (!check.value) {
    return err(
      new ProviderError("Azure OpenAI health check failed", "API_ERROR", undefined, ctx.providerName),
    );
  }
  return ok([]);
}

async function healthCheck(ctx: ProtocolContext): Promise<Result<boolean>> {
  try {
    const response = await fetch(ctx.baseUrl, {
      method: "POST",
      headers: ctx.headers,
      body: JSON.stringify({
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) return ok(true);

    const body = await response.text().catch(() => "");
    const code = response.status === 401 || response.status === 403 ? "AUTH_ERROR" : "API_ERROR";
    return err(
      new ProviderError(
        `Azure OpenAI check failed: ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`,
        code,
        response.status,
        ctx.providerName,
      ),
    );
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

const azureDeploymentProtocol: ProviderProtocol = {
  ...defaultProtocol,
  chatPath: "",
  buildHeaders,
  buildRequestBody,
  listModels,
  healthCheck,
  requiresApiKey: true,
};

export function getAzureProtocolForBaseUrl(baseUrl: string): ProviderProtocol {
  return baseUrl.includes("/openai/deployments/") && baseUrl.includes("/chat/completions")
    ? azureDeploymentProtocol
    : azureV1Protocol;
}

export const azureProtocol: ProviderProtocol = azureV1Protocol;
