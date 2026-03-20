import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createContextStore } from "../../context/store";
import { createEventBus } from "../../core/events/event-bus";
import { createPolicyEngine } from "../../policies/engine";
import { ok } from "../../shared/result";
import type {
  ChatResponse,
  ContextStore,
  LLMProvider,
  PipelineConfig,
  StageDefinition,
  StreamChunk,
} from "../../shared/types";
import { type ExecutorDeps, executePipeline, resolveExecutionOrder } from "./stage-executor";

// ─── Helpers ────────────────────────────────────────────────

function mockProvider(content: string): LLMProvider {
  const response: ChatResponse = {
    id: "test-id",
    model: "test-model",
    content,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    finishReason: "stop",
  };

  return {
    name: "mock",
    chat: mock(() => Promise.resolve(ok(response))),
    stream: async function* (): AsyncGenerator<StreamChunk> {
      yield { type: "content", delta: content };
      yield { type: "done" };
    },
    listModels: mock(() => Promise.resolve(ok([]))),
    healthCheck: mock(() => Promise.resolve(ok(true))),
  };
}

function makePipelineConfig(
  stages: Record<string, StageDefinition>,
  overrides?: Partial<PipelineConfig>,
): PipelineConfig {
  return {
    name: "test-pipeline",
    version: "1.0.0",
    mode: "sequential",
    context: { backend: "sqlite", vector: "embedded", ttl: "7d" },
    providers: {
      mock: { type: "openai-compatible", base_url: "http://localhost" },
    },
    stages,
    policies: { global: {} },
    ...overrides,
  };
}

function makeDeps(
  config: PipelineConfig,
  providers: Record<string, LLMProvider>,
  store: ContextStore & { close(): void },
): ExecutorDeps {
  const policyResult = createPolicyEngine(config.policies.global);
  if (!policyResult.ok) throw policyResult.error;

  return {
    config,
    providers,
    contextStore: store,
    policyEngine: policyResult.value,
    eventBus: createEventBus(),
    workingDir: mkdtempSync(join(tmpdir(), "openmind-test-")),
  };
}

// ─── resolveExecutionOrder ──────────────────────────────────

describe("resolveExecutionOrder", () => {
  test("single stage with no deps", () => {
    const result = resolveExecutionOrder({
      planner: {
        provider: "mock",
        model: "m",
        skill: "s",
        context: { read: [], write: ["plan.*"] },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([["planner"]]);
    }
  });

  test("linear chain", () => {
    const result = resolveExecutionOrder({
      planner: {
        provider: "mock",
        model: "m",
        skill: "s",
        context: { read: [], write: ["plan.*"] },
      },
      coder: {
        provider: "mock",
        model: "m",
        skill: "s",
        context: { read: ["plan.*"], write: ["code.*"] },
        depends_on: ["planner"],
      },
      tester: {
        provider: "mock",
        model: "m",
        skill: "s",
        context: { read: ["code.*"], write: ["test.*"] },
        depends_on: ["coder"],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([["planner"], ["coder"], ["tester"]]);
    }
  });

  test("parallel stages in same layer", () => {
    const result = resolveExecutionOrder({
      planner: {
        provider: "mock",
        model: "m",
        skill: "s",
        context: { read: [], write: ["plan.*"] },
      },
      coder: {
        provider: "mock",
        model: "m",
        skill: "s",
        context: { read: ["plan.*"], write: ["code.*"] },
        depends_on: ["planner"],
      },
      reviewer: {
        provider: "mock",
        model: "m",
        skill: "s",
        context: { read: ["plan.*"], write: ["review.*"] },
        depends_on: ["planner"],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]).toEqual(["planner"]);
      expect(result.value[1].sort()).toEqual(["coder", "reviewer"]);
    }
  });

  test("rejects unknown dependency", () => {
    const result = resolveExecutionOrder({
      coder: {
        provider: "mock",
        model: "m",
        skill: "s",
        context: { read: [], write: [] },
        depends_on: ["nonexistent"],
      },
    });
    expect(result.ok).toBe(false);
  });
});

// ─── executePipeline ────────────────────────────────────────

describe("executePipeline", () => {
  let store: ReturnType<typeof createContextStore>;

  beforeEach(() => {
    store = createContextStore({ dbPath: ":memory:" });
  });

  test("executes single stage successfully", async () => {
    const provider = mockProvider("Architecture: microservices");
    const config = makePipelineConfig({
      planner: {
        provider: "mock",
        model: "gpt-4",
        skill: "core/planner",
        context: { read: [], write: ["planner.*"] },
      },
    });
    const deps = makeDeps(config, { mock: provider }, store);

    const result = await executePipeline(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("success");
    expect(result.value.stages).toHaveLength(1);
    expect(result.value.stages[0].status).toBe("success");
    expect(result.value.stages[0].output).toBe("Architecture: microservices");
    expect(provider.chat).toHaveBeenCalledTimes(1);

    // Verify context was written
    const entry = await store.get("planner.output");
    if (entry.ok && entry.value) {
      expect(entry.value.value).toBe("Architecture: microservices");
    }

    store.close();
  });

  test("executes multi-stage pipeline in order", async () => {
    const callOrder: string[] = [];
    const planProvider: LLMProvider = {
      ...mockProvider("the plan"),
      chat: mock(() => {
        callOrder.push("planner");
        return Promise.resolve(
          ok({
            id: "1",
            model: "m",
            content: "the plan",
            usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
            finishReason: "stop" as const,
          }),
        );
      }),
    };
    const codeProvider: LLMProvider = {
      ...mockProvider("the code"),
      chat: mock(() => {
        callOrder.push("coder");
        return Promise.resolve(
          ok({
            id: "2",
            model: "m",
            content: "the code",
            usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
            finishReason: "stop" as const,
          }),
        );
      }),
    };

    const config = makePipelineConfig({
      planner: {
        provider: "plan-provider",
        model: "gpt-4",
        skill: "core/planner",
        context: { read: [], write: ["planner.*"] },
      },
      coder: {
        provider: "code-provider",
        model: "gpt-4",
        skill: "core/coder",
        context: { read: ["planner.*"], write: ["coder.*"] },
        depends_on: ["planner"],
      },
    });

    const deps = makeDeps(
      config,
      { "plan-provider": planProvider, "code-provider": codeProvider },
      store,
    );

    const result = await executePipeline(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("success");
    expect(result.value.stages).toHaveLength(2);
    expect(callOrder).toEqual(["planner", "coder"]);

    // Coder should have received planner's context
    const chatCall = (codeProvider.chat as ReturnType<typeof mock>).mock.calls[0] as unknown[];
    const request = chatCall[0] as { messages: Array<{ content: string }> };
    expect(request.messages[0].content).toContain("planner.output");
    expect(request.messages[0].content).toContain("the plan");

    store.close();
  });

  test("reports failed status when provider is missing", async () => {
    const config = makePipelineConfig({
      planner: {
        provider: "nonexistent",
        model: "gpt-4",
        skill: "core/planner",
        context: { read: [], write: ["planner.*"] },
      },
    });
    const deps = makeDeps(config, {}, store);

    const result = await executePipeline(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("failed");
    expect(result.value.stages[0].status).toBe("failed");
    expect(result.value.stages[0].error).toContain("not found");

    store.close();
  });

  test("skips downstream stages when upstream fails", async () => {
    const failProvider: LLMProvider = {
      ...mockProvider(""),
      chat: mock(() => Promise.resolve({ ok: false as const, error: new Error("API down") })),
    };

    const config = makePipelineConfig({
      planner: {
        provider: "fail",
        model: "gpt-4",
        skill: "core/planner",
        context: { read: [], write: ["planner.*"] },
      },
      coder: {
        provider: "fail",
        model: "gpt-4",
        skill: "core/coder",
        context: { read: ["planner.*"], write: ["coder.*"] },
        depends_on: ["planner"],
      },
    });

    const deps = makeDeps(config, { fail: failProvider }, store);
    const result = await executePipeline(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("failed");
    expect(result.value.stages[0].status).toBe("failed");
    expect(result.value.stages[1].status).toBe("skipped");

    store.close();
  });

  test("emits events during execution", async () => {
    const provider = mockProvider("output");
    const config = makePipelineConfig({
      stage1: {
        provider: "mock",
        model: "m",
        skill: "s",
        context: { read: [], write: ["stage1.*"] },
      },
    });
    const deps = makeDeps(config, { mock: provider }, store);

    const events: string[] = [];
    deps.eventBus.onAny((e) => events.push(e.type));

    await executePipeline(deps);

    expect(events).toContain("pipeline:start");
    expect(events).toContain("stage:start");
    expect(events).toContain("stage:complete");
    expect(events).toContain("context:write");
    expect(events).toContain("pipeline:complete");

    store.close();
  });

  test("aggregates token usage and cost", async () => {
    const provider = mockProvider("output");
    const config = makePipelineConfig({
      s1: {
        provider: "mock",
        model: "m",
        skill: "s",
        context: { read: [], write: ["s1.*"] },
      },
      s2: {
        provider: "mock",
        model: "m",
        skill: "s",
        context: { read: [], write: ["s2.*"] },
      },
    });
    const deps = makeDeps(config, { mock: provider }, store);

    const result = await executePipeline(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Each stage: 30 total tokens
    expect(result.value.totalTokens.totalTokens).toBe(60);
    expect(result.value.totalCost).toBeGreaterThan(0);

    store.close();
  });
});

// ─── Orchestrated mode ────────────────────────────────────

describe("executePipeline (orchestrated)", () => {
  let store: ReturnType<typeof createContextStore>;

  beforeEach(() => {
    store = createContextStore({ dbPath: ":memory:" });
  });

  test("runs orchestrator stage in orchestrated mode", async () => {
    const provider = mockProvider("Orchestration complete");
    const config = makePipelineConfig(
      {
        orchestrator: {
          provider: "mock",
          model: "gpt-4",
          skill: "core/orchestrator",
          role: "orchestrator",
          context: { read: ["*"], write: ["orchestrator.*"] },
        },
        coder: {
          provider: "mock",
          model: "gpt-4",
          skill: "core/coder",
          context: { read: ["*"], write: ["coder.*"] },
        },
      },
      { mode: "orchestrated" },
    );

    const deps = makeDeps(config, { mock: provider }, store);
    const result = await executePipeline(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only the orchestrator runs directly — coder is available via delegate
    expect(result.value.stages).toHaveLength(1);
    expect(result.value.stages[0].stageName).toBe("orchestrator");
    expect(result.value.stages[0].status).toBe("success");

    store.close();
  });

  test("orchestrator receives delegate tool in its definitions", async () => {
    let receivedTools: string[] = [];
    const provider: LLMProvider = {
      ...mockProvider("done"),
      chat: mock((req) => {
        const request = req as { tools?: Array<{ name: string }> };
        receivedTools = (request.tools ?? []).map((t) => t.name);
        return Promise.resolve(
          ok({
            id: "1",
            model: "m",
            content: "done",
            usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
            finishReason: "stop" as const,
          }),
        );
      }),
    };

    const config = makePipelineConfig(
      {
        orchestrator: {
          provider: "mock",
          model: "gpt-4",
          skill: "core/orchestrator",
          role: "orchestrator",
          context: { read: ["*"], write: ["orchestrator.*"] },
        },
        agent1: {
          provider: "mock",
          model: "gpt-4",
          skill: "core/agent",
          context: { read: [], write: ["agent1.*"] },
        },
      },
      { mode: "orchestrated" },
    );

    const deps = makeDeps(config, { mock: provider }, store);
    await executePipeline(deps);

    expect(receivedTools).toContain("delegate");

    store.close();
  });

  test("sequential mode still works (regression)", async () => {
    const provider = mockProvider("output");
    const config = makePipelineConfig({
      s1: {
        provider: "mock",
        model: "m",
        skill: "s",
        context: { read: [], write: ["s1.*"] },
      },
    });
    // mode defaults to "sequential"
    expect(config.mode).toBe("sequential");

    const deps = makeDeps(config, { mock: provider }, store);
    const result = await executePipeline(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("success");

    store.close();
  });
});
