import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ResolvedProvider } from "../../shared/types";
import { clearRateLimiters, clearTpmLimiters } from "../resilience";
import { createProviderFromConfig } from "./provider-factory";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearRateLimiters();
  clearTpmLimiters();
});

describe("Provider Factory", () => {
  test("creates OpenAI-compatible adapter", () => {
    const config: ResolvedProvider = {
      type: "openai-compatible",
      base_url: "https://api.openai.com/v1",
      api_key: "sk-test",
    };
    const result = createProviderFromConfig("openai", config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("openai");
    }
  });

  test("creates Anthropic adapter by provider name", () => {
    const config: ResolvedProvider = {
      type: "openai-compatible",
      base_url: "https://api.anthropic.com/v1",
      api_key: "sk-ant-test",
    };
    const result = createProviderFromConfig("anthropic", config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("anthropic");
    }
  });

  test("returns error for provider that requires api_key without one", () => {
    const config: ResolvedProvider = {
      type: "openai-compatible",
      base_url: "https://api.anthropic.com/v1",
    };
    const result = createProviderFromConfig("anthropic", config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AUTH_ERROR");
    }
  });

  test("creates Ollama adapter", () => {
    const config: ResolvedProvider = {
      type: "ollama",
      base_url: "http://localhost:11434",
    };
    const result = createProviderFromConfig("local", config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("local");
    }
  });

  test("creates custom adapter", () => {
    const config: ResolvedProvider = {
      type: "custom",
      base_url: "https://my-proxy.com/v1",
      api_key: "custom-key",
      headers: { "X-Custom": "value" },
    };
    const result = createProviderFromConfig("custom", config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("custom");
    }
  });

  test("azure v1 keeps the stage model and uses the v1 chat endpoint", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    let capturedHeaders: HeadersInit | undefined;

    globalThis.fetch = mock((url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = init.body as string;
      capturedHeaders = init.headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: "test",
          model: "deployment-a",
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      } as unknown as Response);
    });

    const result = createProviderFromConfig("azure", {
      type: "openai-compatible",
      base_url: "https://my-resource.openai.azure.com/openai/v1",
      api_key: "azure-key",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const chat = await result.value.chat({
      model: "deployment-a",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(chat.ok).toBe(true);
    expect(capturedUrl).toBe("https://my-resource.openai.azure.com/openai/v1/chat/completions");
    expect(JSON.parse(capturedBody).model).toBe("deployment-a");
    expect((capturedHeaders as Record<string, string>)["api-key"]).toBe("azure-key");
  });

  test("azure legacy deployment endpoint does not send model in the body", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    globalThis.fetch = mock((url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = init.body as string;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: "test",
          model: "deployment-a",
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      } as unknown as Response);
    });

    const url = "https://my-resource.openai.azure.com/openai/deployments/deployment-a/chat/completions?api-version=2024-10-21";
    const result = createProviderFromConfig("azure", {
      type: "openai-compatible",
      base_url: url,
      api_key: "azure-key",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const chat = await result.value.chat({
      model: "deployment-a",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(chat.ok).toBe(true);
    expect(capturedUrl).toBe(url);
    expect(JSON.parse(capturedBody).model).toBeUndefined();
  });
});
