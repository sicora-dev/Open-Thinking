import { describe, expect, test } from "bun:test";
import type { ProviderConfig } from "../../shared/types";
import { createProviderFromConfig } from "./provider-factory";

describe("Provider Factory", () => {
  test("creates OpenAI-compatible adapter", () => {
    const config: ProviderConfig = {
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

  test("creates Anthropic adapter when base_url contains anthropic.com", () => {
    const config: ProviderConfig = {
      type: "openai-compatible",
      base_url: "https://api.anthropic.com/v1",
      api_key: "sk-ant-test",
    };
    const result = createProviderFromConfig("claude", config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("claude");
    }
  });

  test("returns error for Anthropic without api_key", () => {
    const config: ProviderConfig = {
      type: "openai-compatible",
      base_url: "https://api.anthropic.com/v1",
    };
    const result = createProviderFromConfig("claude", config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AUTH_ERROR");
    }
  });

  test("creates Ollama adapter", () => {
    const config: ProviderConfig = {
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
    const config: ProviderConfig = {
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
