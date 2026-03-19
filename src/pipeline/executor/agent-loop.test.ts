import { describe, expect, mock, test } from "bun:test";
import { createEventBus } from "../../core/events/event-bus";
import { ok } from "../../shared/result";
import type { ChatRequest, ChatResponse, LLMProvider, StreamChunk } from "../../shared/types";
import type { ToolRegistry } from "../../tools";
import { runAgentLoop } from "./agent-loop";

function mockProvider(responses: ChatResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    chat: mock(() => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return Promise.resolve(ok(response as ChatResponse));
    }),
    stream: async function* (): AsyncGenerator<StreamChunk> {
      yield { type: "done" };
    },
    listModels: mock(() => Promise.resolve(ok([]))),
    healthCheck: mock(() => Promise.resolve(ok(true))),
  };
}

function mockToolRegistry(): ToolRegistry {
  return {
    definitions: () => [{ name: "read_file", description: "Read a file", parameters: {} }],
    execute: mock(async (name: string, _args: Record<string, unknown>) => {
      if (name === "read_file") return ok("file contents here");
      return ok("ok");
    }),
  };
}

const baseRequest: ChatRequest = {
  model: "test",
  messages: [{ role: "user", content: "do something" }],
};

describe("Agent Loop", () => {
  test("single turn — no tool calls", async () => {
    const provider = mockProvider([
      {
        id: "1",
        model: "test",
        content: "Done!",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "stop",
      },
    ]);

    const result = await runAgentLoop({
      provider,
      request: baseRequest,
      toolRegistry: mockToolRegistry(),
      maxIterations: 10,
      eventBus: createEventBus(),
      stageName: "test-stage",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.finalContent).toBe("Done!");
    expect(result.value.iterations).toBe(1);
    expect(result.value.totalUsage.totalTokens).toBe(15);
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });

  test("multi-turn — tool call then stop", async () => {
    const provider = mockProvider([
      {
        id: "1",
        model: "test",
        content: "",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"src/index.ts"}' },
          },
        ],
      },
      {
        id: "2",
        model: "test",
        content: "Here is the file analysis.",
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        finishReason: "stop",
      },
    ]);

    const registry = mockToolRegistry();
    const eventBus = createEventBus();
    const events: string[] = [];
    eventBus.onAny((e) => events.push(e.type));

    const result = await runAgentLoop({
      provider,
      request: baseRequest,
      toolRegistry: registry,
      maxIterations: 10,
      eventBus,
      stageName: "analyzer",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.finalContent).toBe("Here is the file analysis.");
    expect(result.value.iterations).toBe(2);
    expect(result.value.totalUsage.totalTokens).toBe(45);
    expect(provider.chat).toHaveBeenCalledTimes(2);
    expect(registry.execute).toHaveBeenCalledTimes(1);

    expect(events).toContain("tool:call");
    expect(events).toContain("tool:result");
  });

  test("respects maxIterations", async () => {
    // Provider always returns tool_calls
    const provider = mockProvider([
      {
        id: "1",
        model: "test",
        content: "",
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"x"}' },
          },
        ],
      },
    ]);

    const result = await runAgentLoop({
      provider,
      request: baseRequest,
      toolRegistry: mockToolRegistry(),
      maxIterations: 3,
      eventBus: createEventBus(),
      stageName: "looper",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.iterations).toBe(3);
    expect(provider.chat).toHaveBeenCalledTimes(3);
  });

  test("passes tool results back in messages", async () => {
    let capturedMessages: unknown[] = [];
    const provider: LLMProvider = {
      name: "mock",
      chat: mock((req: ChatRequest) => {
        capturedMessages = req.messages;
        // First call returns tool_call, second returns stop
        if (capturedMessages.length <= 1) {
          return Promise.resolve(
            ok({
              id: "1",
              model: "test",
              content: "",
              usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
              finishReason: "tool_calls" as const,
              toolCalls: [
                {
                  id: "call_1",
                  type: "function" as const,
                  function: { name: "read_file", arguments: '{"path":"f.txt"}' },
                },
              ],
            }),
          );
        }
        return Promise.resolve(
          ok({
            id: "2",
            model: "test",
            content: "final",
            usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
            finishReason: "stop" as const,
          }),
        );
      }),
      stream: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: "done" };
      },
      listModels: mock(() => Promise.resolve(ok([]))),
      healthCheck: mock(() => Promise.resolve(ok(true))),
    };

    const result = await runAgentLoop({
      provider,
      request: baseRequest,
      toolRegistry: mockToolRegistry(),
      maxIterations: 10,
      eventBus: createEventBus(),
      stageName: "test",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Second call should have: user msg + assistant msg (with tool_calls) + tool result
    const msgs = result.value.messages;
    expect(msgs.some((m) => m.role === "tool")).toBe(true);
    const toolMsg = msgs.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("file contents here");
    expect(toolMsg?.tool_call_id).toBe("call_1");
  });
});
