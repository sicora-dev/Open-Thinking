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
    const isDeploymentUrl = ctx.baseUrl.includes("/openai/deployments/") && ctx.baseUrl.includes("/chat/completions");
    const baseUrlClean = ctx.baseUrl.endsWith("/") ? ctx.baseUrl.slice(0, -1) : ctx.baseUrl;
    const checkUrl = isDeploymentUrl ? ctx.baseUrl : `${baseUrlClean}/chat/completions`;

    const response = await fetch(checkUrl, {
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
    
    // For classic dynamic base URLs, doing a POST without a deployment URL returns 400 or 404,
    // but the fact that it didn't return 401 means auth is valid and connection is healthy.
    if (!isDeploymentUrl && (response.status === 400 || response.status === 404) && body.includes("error")) {
      return ok(true);
    }
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

const azureClassicDynamicProtocol: ProviderProtocol = {
  ...defaultProtocol,
  chatPath: "", // overridden by buildChatUrl
  buildChatUrl: (baseUrl: string, request: ChatRequest) => {
    const base = baseUrl.replace(/\/openai\/v1\/?$/, "");
    return `${base}/openai/deployments/${request.model}/chat/completions?api-version=2024-02-15-preview`;
  },
  buildHeaders,
  buildRequestBody, // This strips the 'model' property
  listModels,
  healthCheck,
  requiresApiKey: true,
};

const azureFoundryProtocol: ProviderProtocol = {
  ...defaultProtocol,
  chatPath: "", // User must provide the full /responses url, or we assume it
  buildChatUrl: (baseUrl: string, request: ChatRequest) => {
    // If baseUrl is the bare project url, append the foundry endpoint
    if (!baseUrl.endsWith("/responses")) {
      const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
      return `${base}/openai/v1/responses`;
    }
    return baseUrl;
  },
  buildHeaders: (apiKey?: string, extraHeaders?: Record<string, string>) => {
    // Foundry might accept api-key, but standard Azure AI uses api-key as well.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    if (apiKey) headers["api-key"] = apiKey;
    return headers;
  },
  buildRequestBody: (request: ChatRequest) => {
    // Foundry Protocol expects { input: string } instead of messages
    const lastUserMessage = request.messages.filter((m) => m.role === "user").pop();
    const systemMessage = request.messages.find((m) => m.role === "system");
    
    // Combine system and last user message for the input (since Foundry agents are stateful, 
    // sending the whole history might not be perfectly supported by basic /responses, 
    // but we can serialize it as text).
    let inputStr = "";
    if (systemMessage) inputStr += `[System]: ${systemMessage.content}\n\n`;
    for (const m of request.messages) {
      if (m.role !== "system") {
        inputStr += `[${m.role}]: ${m.content}\n`;
      }
    }

    return {
      // 'model' field is still used by Azure AI SDK for routing within the project
      model: request.model,
      input: inputStr.trim(),
    };
  },
  // We need to parse response differently too?
  // Foundries usually return { data: { output: string } } or { choices: [ { message: { content: ... } } ] }
  // We will pass through to default parseResponse for now, but gracefully fallback if it's different.
  parseResponse: (data: Record<string, unknown>) => {
    try {
      if (data.choices) return defaultProtocol.parseResponse(data);
      if (data.error) throw new Error(JSON.stringify(data.error));
      
      // Foundry specific response structure
      return {
        id: (data.id as string) || crypto.randomUUID(),
        model: (data.model as string) || "foundry-agent",
        content: (data.output as string) || JSON.stringify(data),
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: "stop",
      };
    } catch(e) {
      throw e;
    }
  },
  listModels,
  healthCheck: async (ctx: ProtocolContext): Promise<Result<boolean>> => {
    // foundry URL health check just does a generic POST
    try {
      const url = ctx.baseUrl.endsWith("/responses") ? ctx.baseUrl : `${ctx.baseUrl.replace(/\/$/, "")}/openai/v1/responses`;
      const response = await fetch(url, {
        method: "POST",
        headers: ctx.headers,
        body: JSON.stringify({ input: "ping", model: "test" }),
        signal: AbortSignal.timeout(10_000),
      });
      // 400 with API error is still reachable
      if (response.ok) return ok(true);
      const text = await response.text().catch(() => "");
      if (response.status === 400 || response.status === 404 || response.status === 422) {
        if (text.includes("error")) return ok(true);
      }
      return err(new ProviderError(`Foundry check failed: ${response.status}`, "API_ERROR", response.status, ctx.providerName));
    } catch(e) {
      return err(new ProviderError(String(e), "API_ERROR", undefined, ctx.providerName));
    }
  },
  requiresApiKey: true,
};

export function getAzureProtocolForBaseUrl(baseUrl: string): ProviderProtocol {
  if (baseUrl.includes("/openai/deployments/") && baseUrl.includes("/chat/completions")) {
    return azureDeploymentProtocol;
  }
  if (baseUrl.includes(".openai.azure.com")) {
    return azureClassicDynamicProtocol;
  }
  if (baseUrl.includes(".services.ai.azure.com")) {
    return azureFoundryProtocol;
  }
  return azureV1Protocol;
}

export const azureProtocol: ProviderProtocol = azureV1Protocol;
