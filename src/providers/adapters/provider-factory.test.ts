import { describe, expect, test } from "bun:test";
import type { ResolvedProvider } from "../../shared/types";
import { createProviderFromConfig } from "./provider-factory";

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
});
