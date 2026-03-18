import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatRequest, LLMProvider } from "../../shared/types";
import { createOpenAICompatibleAdapter } from "./openai-compatible-adapter";

// Mock fetch globally
const originalFetch = globalThis.fetch;

function mockFetch(response: {
  ok: boolean;
  status: number;
  statusText?: string;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
  body?: ReadableStream | null;
}) {
  globalThis.fetch = mock(() => Promise.resolve(response as unknown as Response));
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

describe("OpenAI Compatible Adapter", () => {
  let adapter: LLMProvider;

  beforeEach(() => {
    adapter = createOpenAICompatibleAdapter({
      name: "test-provider",
      baseUrl: "https://api.test.com/v1",
      apiKey: "test-key",
    });
  });

  afterEach(() => {
    restoreFetch();
  });

  const basicRequest: ChatRequest = {
    model: "gpt-4",
    messages: [{ role: "user", content: "Hello" }],
  };

  describe("chat", () => {
    test("returns parsed response on success", async () => {
      mockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          id: "chatcmpl-123",
          model: "gpt-4",
          choices: [
            {
              message: { role: "assistant", content: "Hi there!" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        }),
      });

      const result = await adapter.chat(basicRequest);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.id).toBe("chatcmpl-123");
      expect(result.value.content).toBe("Hi there!");
      expect(result.value.finishReason).toBe("stop");
      expect(result.value.usage.totalTokens).toBe(15);
    });

    test("includes system prompt in messages", async () => {
      let capturedBody = "";
      globalThis.fetch = mock((url: string, init: RequestInit) => {
        capturedBody = init.body as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: "test",
            model: "gpt-4",
            choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
        } as unknown as Response);
      });

      await adapter.chat({
        ...basicRequest,
        systemPrompt: "You are helpful",
      });

      const parsed = JSON.parse(capturedBody);
      expect(parsed.messages[0]).toEqual({
        role: "system",
        content: "You are helpful",
      });
    });

    test("returns error on 401", async () => {
      mockFetch({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Invalid API key",
      });

      const result = await adapter.chat(basicRequest);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("AUTH_ERROR");
      expect(result.error.statusCode).toBe(401);
    });

    test("returns error on 429 rate limit", async () => {
      mockFetch({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: async () => "Rate limited",
      });

      const result = await adapter.chat(basicRequest);
      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.error.code).toBe("RATE_LIMIT");
    });

    test("handles tool calls in response", async () => {
      mockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          id: "test",
          model: "gpt-4",
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call_123",
                    type: "function",
                    function: {
                      name: "get_weather",
                      arguments: '{"city":"Paris"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      });

      const result = await adapter.chat(basicRequest);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.finishReason).toBe("tool_calls");
      expect(result.value.toolCalls).toHaveLength(1);
      expect(result.value.toolCalls?.[0].function.name).toBe("get_weather");
    });

    test("sends authorization header", async () => {
      let capturedHeaders: Record<string, string> = {};
      globalThis.fetch = mock((_url: string, init: RequestInit) => {
        capturedHeaders = init.headers as Record<string, string>;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: "test",
            model: "gpt-4",
            choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
        } as unknown as Response);
      });

      await adapter.chat(basicRequest);
      expect(capturedHeaders.Authorization).toBe("Bearer test-key");
    });
  });

  describe("healthCheck", () => {
    test("returns true when endpoint is reachable", async () => {
      mockFetch({ ok: true, status: 200 });
      const result = await adapter.healthCheck();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(true);
    });

    test("returns false on network error", async () => {
      globalThis.fetch = mock(() => Promise.reject(new Error("ECONNREFUSED")));
      const result = await adapter.healthCheck();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(false);
    });
  });

  describe("listModels", () => {
    test("returns parsed model list", async () => {
      mockFetch({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "gpt-4", name: "GPT-4" },
            { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
          ],
        }),
      });

      const result = await adapter.listModels();
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(2);
      expect(result.value[0].id).toBe("gpt-4");
      expect(result.value[0].provider).toBe("test-provider");
    });
  });
});
