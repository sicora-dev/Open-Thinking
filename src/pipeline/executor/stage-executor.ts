/**
 * Stage executor: runs pipeline stages in DAG order.
 * Handles sequential/parallel execution, context I/O, policy enforcement,
 * and failure routing (retry, re-route).
 */
import type { EventBus } from "../../core/events/event-bus";
import type { PermissionEngine } from "../../core/permissions";
import type { PolicyEngine } from "../../policies/engine";
import { estimateCost as estimateCostFromPricing, isLocalProvider } from "../../providers/pricing";
import { loadSkillDefinition } from "../../skills/catalog";
import { ProviderError } from "../../shared/errors";
import { type Result, err, ok } from "../../shared/result";
import type {
  ChatRequest,
  ContextEntry,
  ContextStore,
  LLMProvider,
  PipelineConfig,
  PipelineRunResult,
  StageDefinition,
  StageResult,
  TokenUsage,
} from "../../shared/types";
import { createDelegateTool, createToolRegistry } from "../../tools";
import {
  formatPersistentContext,
  loadStageContext,
  readLearned,
  readRecentHistory,
} from "../../workspace";
import { type AgentLoopConfig, type AgentLoopResult, runAgentLoop } from "./agent-loop";

export type ExecutorDeps = {
  config: PipelineConfig;
  providers: Record<string, LLMProvider>;
  contextStore: ContextStore;
  policyEngine: PolicyEngine;
  eventBus: EventBus;
  /** Working directory of the project. Used for persistent context (.openthk/). */
  workingDir: string;
  /** Base directory or directories for resolving skill paths. */
  skillsDir?: string | string[];
  /** Abort signal for cancellation support. */
  signal?: AbortSignal;
  /**
   * Called when a stage hits the output token limit after auto-retries.
   * Returns true to continue, false to stop.
   */
  onTokenLimit?: (stageName: string, summary: import("./agent-loop").WorkSummary) => Promise<boolean>;
  /** Permission engine for human-in-the-loop tool approval. */
  permissionEngine?: PermissionEngine;
};

/**
 * Resolve stage execution order from the DAG defined by depends_on.
 * Returns stages grouped into layers: each layer can run in parallel,
 * layers must run sequentially.
 */
export function resolveExecutionOrder(stages: Record<string, StageDefinition>): Result<string[][]> {
  const stageNames = new Set(Object.keys(stages));
  const resolved = new Set<string>();
  const layers: string[][] = [];

  // Validate all dependencies exist
  for (const [name, def] of Object.entries(stages)) {
    for (const dep of def.depends_on ?? []) {
      if (!stageNames.has(dep)) {
        return err(
          new ProviderError(`Stage "${name}" depends on unknown stage "${dep}"`, "NOT_FOUND"),
        );
      }
    }
  }

  let remaining = new Set(stageNames);
  while (remaining.size > 0) {
    const layer: string[] = [];
    for (const name of remaining) {
      const stageDef = stages[name];
      if (!stageDef) continue;
      const deps = stageDef.depends_on ?? [];
      if (deps.every((d) => resolved.has(d))) {
        layer.push(name);
      }
    }

    if (layer.length === 0) {
      return err(new ProviderError("Circular dependency detected in stage DAG", "API_ERROR"));
    }

    layers.push(layer);
    for (const name of layer) {
      resolved.add(name);
      remaining.delete(name);
    }
    remaining = new Set(remaining);
  }

  return ok(layers);
}

/**
 * Build the context payload for a stage based on its read permissions.
 */
async function buildContextPayload(
  stageName: string,
  permissions: StageDefinition["context"],
  contextStore: ContextStore,
  policyEngine: PolicyEngine,
  eventBus: EventBus,
): Promise<Result<Record<string, string>>> {
  const allEntries = await contextStore.list();
  if (!allEntries.ok) return err(allEntries.error);

  const payload: Record<string, string> = {};
  const readableKeys = policyEngine.filterReadable(
    permissions,
    allEntries.value.map((e) => e.key),
  );

  for (const key of readableKeys) {
    const entry = allEntries.value.find((e: ContextEntry) => e.key === key);
    if (entry) {
      const check = policyEngine.checkRead(stageName, permissions, key);
      if (check.ok) {
        payload[key] = entry.value;
        eventBus.emit({ type: "context:read", stageName, key });
      }
    }
  }

  return ok(payload);
}

/**
 * Bytes under which a context entry is always inlined eagerly.
 * Smaller than this and the round-trip cost of `get_context(key)` exceeds
 * the cost of just including the value upfront.
 */
const EAGER_INLINE_THRESHOLD = 500;

/**
 * Format context as a string block for the LLM prompt.
 *
 * Two modes:
 * - **eager** (legacy / opt-in): every readable entry inlined fully.
 *   Use only when the stage genuinely needs everything every iteration —
 *   it is *much* more expensive in tokens.
 * - **lazy** (default): an *index* of available keys is shown, plus the
 *   inline content of small entries (< EAGER_INLINE_THRESHOLD bytes).
 *   The model fetches large values via the `get_context(key)` tool only
 *   when it actually needs them.
 *
 * Returns the formatted block plus the byte count of what was inlined,
 * so callers can attribute it in the token meter breakdown.
 */
function formatContextForPrompt(
  context: Record<string, string>,
  eager: boolean,
): { block: string; bytes: number } {
  const entries = Object.entries(context);
  if (entries.length === 0) return { block: "", bytes: 0 };

  if (eager) {
    const lines = entries.map(([key, value]) => `[${key}]\n${value}`);
    const block = `\n\n--- Context ---\n${lines.join("\n\n")}\n--- End Context ---`;
    return { block, bytes: new TextEncoder().encode(block).length };
  }

  // Lazy mode: index + inline-small.
  const indexLines: string[] = [];
  const inlineParts: string[] = [];
  for (const [key, value] of entries) {
    const size = new TextEncoder().encode(value).length;
    if (size <= EAGER_INLINE_THRESHOLD) {
      inlineParts.push(`[${key}]\n${value}`);
      indexLines.push(`  - ${key} (${size}B, inlined above)`);
    } else {
      indexLines.push(`  - ${key} (${formatBytesShort(size)}, fetch with get_context("${key}"))`);
    }
  }

  const sections: string[] = [];
  if (inlineParts.length > 0) {
    sections.push(`--- Context (inlined) ---\n${inlineParts.join("\n\n")}\n--- End Context ---`);
  }
  sections.push(`--- Available context keys ---\n${indexLines.join("\n")}\n--- End ---`);
  const block = `\n\n${sections.join("\n\n")}`;
  return { block, bytes: new TextEncoder().encode(block).length };
}

/**
 * Seed the lazy persistent context entries (`persistent.learned`,
 * `persistent.history`) into the context store. The agent fetches them
 * on demand via `get_context(...)` instead of paying their full cost
 * on every iteration via the system prompt.
 *
 * Best-effort: failures are silent. The agent simply won't see the keys.
 *
 * Note: read permissions for these keys are granted automatically by
 * a glob extension below — see `effectiveReadPermissions`.
 */
async function seedPersistentLazyContext(
  workingDir: string,
  stageName: string,
  contextStore: ContextStore,
): Promise<void> {
  const learned = readLearned(workingDir);
  if (learned) {
    await contextStore.set("persistent.learned", learned, stageName);
  }
  const history = readRecentHistory(workingDir);
  if (history) {
    await contextStore.set("persistent.history", history, stageName);
  }
}

function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Write stage output to context store, respecting write policies.
 */
async function writeStageOutput(
  stageName: string,
  permissions: StageDefinition["context"],
  output: string,
  contextStore: ContextStore,
  policyEngine: PolicyEngine,
  eventBus: EventBus,
): Promise<Result<string[]>> {
  // Write the stage output under stageName's default key
  const defaultKey = `${stageName}.output`;
  const writeCheck = policyEngine.checkWrite(stageName, permissions, defaultKey);
  if (!writeCheck.ok) return err(writeCheck.error);

  const writeResult = await contextStore.set(defaultKey, output, stageName);
  if (!writeResult.ok) return err(writeResult.error);

  eventBus.emit({ type: "context:write", stageName, key: defaultKey });
  return ok([defaultKey]);
}

/**
 * Execute a single stage: build context, call provider, write output.
 */
async function executeStage(
  stageName: string,
  stageDef: StageDefinition,
  deps: ExecutorDeps,
): Promise<StageResult> {
  const start = Date.now();
  const { providers, contextStore, policyEngine, eventBus } = deps;

  // Check for cancellation before starting
  if (deps.signal?.aborted) {
    return {
      stageName,
      status: "skipped",
      durationMs: 0,
      contextKeysWritten: [],
    };
  }

  const provider = providers[stageDef.provider];
  if (!provider) {
    return {
      stageName,
      status: "failed",
      durationMs: Date.now() - start,
      error: `Provider "${stageDef.provider}" not found`,
      contextKeysWritten: [],
    };
  }

  eventBus.emit({ type: "stage:start", stageName, model: stageDef.model });

  // Rate limit check
  const rateCheck = policyEngine.tryConsumeRate(stageName);
  if (!rateCheck.ok) {
    const error = rateCheck.error.message;
    eventBus.emit({ type: "stage:error", stageName, error });
    eventBus.emit({ type: "policy:violation", stageName, rule: "rate_limit", detail: error });
    return {
      stageName,
      status: "failed",
      durationMs: Date.now() - start,
      error,
      contextKeysWritten: [],
    };
  }

  // Seed lazy persistent context (learned + history) into the context store
  // so the agent can fetch it via get_context. This must happen *before*
  // we build the context payload so the keys appear in the index.
  await seedPersistentLazyContext(deps.workingDir, stageName, contextStore);

  // Build context payload
  const contextResult = await buildContextPayload(
    stageName,
    stageDef.context,
    contextStore,
    policyEngine,
    eventBus,
  );
  if (!contextResult.ok) {
    const error = contextResult.error.message;
    eventBus.emit({ type: "stage:error", stageName, error });
    return {
      stageName,
      status: "failed",
      durationMs: Date.now() - start,
      error,
      contextKeysWritten: [],
    };
  }

  const { block: contextBlock, bytes: contextBytes } = formatContextForPrompt(
    contextResult.value,
    stageDef.context.eager === true,
  );

  // Load skill prompt + manifest (tool permissions)
  const skill = loadSkillDefinition(stageDef.skill, deps.skillsDir);

  // Resolve tool permissions: stage YAML overrides > skill manifest > all tools
  const allowedTools = stageDef.allowed_tools ?? skill.allowedTools ?? undefined;
  const toolRegistry = createToolRegistry(
    deps.workingDir,
    allowedTools,
    {
      contextStore,
      permissions: stageDef.context,
      policyEngine,
      stageName,
    },
    deps.permissionEngine ? { engine: deps.permissionEngine, stageName } : undefined,
  );

  // Build chat request — inject persistent context (project soul, user prefs, etc.)
  const persistentCtx = loadStageContext(deps.workingDir, stageName);
  const persistentBlock = formatPersistentContext(persistentCtx);
  const persistentBytes = new TextEncoder().encode(persistentBlock).length;

  const basePrompt = stageDef.system_message
    ? `${skill.prompt ?? `You are the "${stageName}" stage in an AI pipeline.`}\n\n--- Stage Instruction ---\n${stageDef.system_message}`
    : skill.prompt ?? `You are the "${stageName}" stage in an AI pipeline.`;
  const systemPrompt = persistentBlock
    ? `${basePrompt}\n\n--- Persistent Context ---\n${persistentBlock}`
    : basePrompt;

  const request: ChatRequest = {
    model: stageDef.model,
    messages: [
      {
        role: "user",
        content: contextBlock
          ? `Complete your task based on the following context.${contextBlock}`
          : "Complete your task.",
      },
    ],
    systemPrompt,
    maxTokens: stageDef.max_completion_tokens ? undefined : (stageDef.max_tokens ?? 16384),
    maxCompletionTokens: stageDef.max_completion_tokens,
    temperature: stageDef.temperature,
    tools: toolRegistry.definitions(),
    timeoutMs: stageDef.timeout ? stageDef.timeout * 1000 : undefined,
  };

  // Run agent loop (iterates: chat -> tool calls -> chat -> ... -> stop)
  const maxIterations = stageDef.max_iterations ?? 50;
  const loopResult = await runAgentLoop({
    provider,
    request,
    toolRegistry,
    maxIterations,
    eventBus,
    stageName,
    providerType: deps.config.providers[stageDef.provider]?.type,
    initialContextBytes: contextBytes,
    initialPersistentContextBytes: persistentBytes,
    signal: deps.signal,
    onTokenLimit: deps.onTokenLimit
      ? (summary) => deps.onTokenLimit!(stageName, summary)
      : undefined,
  });
  if (!loopResult.ok) {
    const error = loopResult.error.message;
    eventBus.emit({ type: "stage:error", stageName, error });
    return {
      stageName,
      status: "failed",
      durationMs: Date.now() - start,
      error,
      contextKeysWritten: [],
    };
  }

  const agentResult = loopResult.value;

  // Cost tracking
  const providerType = deps.config.providers[stageDef.provider]?.type ?? "openai-compatible";
  const cost = estimateStageCost(agentResult.totalUsage, stageDef.model, providerType);
  const costCheck = policyEngine.recordCost(cost, stageName);
  if (!costCheck.ok) {
    const error = costCheck.error.message;
    eventBus.emit({ type: "stage:error", stageName, error });
    eventBus.emit({ type: "policy:violation", stageName, rule: "cost_limit", detail: error });
    return {
      stageName,
      status: "failed",
      durationMs: Date.now() - start,
      error,
      usage: agentResult.totalUsage,
      cost,
      contextKeysWritten: [],
    };
  }

  // Write output to context
  const writeResult = await writeStageOutput(
    stageName,
    stageDef.context,
    agentResult.finalContent,
    contextStore,
    policyEngine,
    eventBus,
  );

  const contextKeysWritten = writeResult.ok ? writeResult.value : [];
  if (!writeResult.ok) {
    eventBus.emit({
      type: "policy:violation",
      stageName,
      rule: "write_access",
      detail: writeResult.error.message,
    });
  }

  const result: StageResult = {
    stageName,
    status: "success",
    output: agentResult.finalContent,
    usage: agentResult.totalUsage,
    breakdown: agentResult.breakdown,
    cost,
    durationMs: Date.now() - start,
    contextKeysWritten,
    stopReason: agentResult.stopReason,
    workSummary: agentResult.workSummary,
  };

  eventBus.emit({ type: "stage:complete", result });
  return result;
}

/**
 * Estimate cost in USD for a stage's token usage.
 *
 * Resolves model pricing from the canonical pricing table. For local
 * providers (ollama, etc.) the cost is always 0. For models not in the
 * pricing table the function returns 0 — the caller is responsible for
 * surfacing "unknown pricing" in the UI separately if it cares.
 */
function estimateStageCost(
  usage: TokenUsage,
  model: string,
  providerType: string,
): number {
  const cost = estimateCostFromPricing(usage, model, isLocalProvider(providerType));
  return cost ?? 0;
}

/** Check if a stage failure was caused by a rate limit error. */
function isRateLimitFailure(result: StageResult): boolean {
  if (!result.error) return false;
  // ProviderError with RATE_LIMIT code or HTTP 429 in error message
  return result.error.includes("RATE_LIMIT") || result.error.includes("429");
}

/**
 * Execute a stage with retry support and model fallback chain.
 *
 * 1. Run the stage with its primary model (retries are handled at the HTTP level by the adapter)
 * 2. If it fails with on_fail config, retry the stage itself
 * 3. If it still fails with a RATE_LIMIT error and fallback_models are defined, try the next model
 */
async function executeStageWithRetry(
  stageName: string,
  stageDef: StageDefinition,
  deps: ExecutorDeps,
): Promise<StageResult> {
  let result = await executeStage(stageName, stageDef, deps);

  // Stage-level retries (on_fail config)
  if (result.status === "failed" && stageDef.on_fail) {
    const { max_retries, inject_context } = stageDef.on_fail;

    for (let attempt = 0; attempt < max_retries && result.status === "failed"; attempt++) {
      if (inject_context && result.error) {
        await deps.contextStore.set(inject_context, result.error, stageName);
      }
      result = await executeStage(stageName, stageDef, deps);
    }
  }

  // Model fallback chain: if still failing due to rate limits, try fallback models
  if (
    result.status === "failed" &&
    isRateLimitFailure(result) &&
    stageDef.fallback_models?.length
  ) {
    for (const fallbackModel of stageDef.fallback_models) {
      deps.eventBus.emit({
        type: "stage:model-fallback",
        stageName,
        fromModel: stageDef.model,
        toModel: fallbackModel,
      });

      // Create a modified stage def with the fallback model
      const fallbackDef = { ...stageDef, model: fallbackModel };
      result = await executeStage(stageName, fallbackDef, deps);

      if (result.status !== "failed" || !isRateLimitFailure(result)) {
        break; // Either succeeded or failed for a non-rate-limit reason
      }
    }
  }

  return result;
}

/**
 * Execute an orchestrated pipeline: run only the orchestrator stage,
 * which delegates to other agents via the `delegate` tool.
 */
async function executeOrchestrated(deps: ExecutorDeps): Promise<Result<PipelineRunResult>> {
  const { config, eventBus } = deps;
  const runId = crypto.randomUUID();
  const start = Date.now();

  eventBus.emit({ type: "pipeline:start", pipelineName: config.name, runId });

  // Find the orchestrator stage
  const orchestratorEntry = Object.entries(config.stages).find(
    ([, s]) => s.role === "orchestrator",
  );
  if (!orchestratorEntry) {
    return err(new ProviderError("No orchestrator stage found", "NOT_FOUND"));
  }

  const [orchestratorName, orchestratorDef] = orchestratorEntry;

  // Create the delegate tool with access to all deps
  const delegateTool = createDelegateTool({
    config,
    providers: deps.providers,
    contextStore: deps.contextStore,
    policyEngine: deps.policyEngine,
    eventBus,
    workingDir: deps.workingDir,
    skillsDir: deps.skillsDir,
    signal: deps.signal,
    onTokenLimit: deps.onTokenLimit,
    runAgentLoop,
  });

  // Execute the orchestrator stage with the delegate tool injected
  const result = await executeStageWithDelegateTool(
    orchestratorName,
    orchestratorDef,
    deps,
    delegateTool,
  );

  const totalTokens: TokenUsage = {
    promptTokens: result.usage?.promptTokens ?? 0,
    completionTokens: result.usage?.completionTokens ?? 0,
    totalTokens: result.usage?.totalTokens ?? 0,
  };

  const pipelineResult: PipelineRunResult = {
    pipelineName: config.name,
    runId,
    status: result.status === "success" ? "success" : "failed",
    stages: [result],
    totalDurationMs: Date.now() - start,
    totalCost: result.cost ?? 0,
    totalTokens,
  };

  eventBus.emit({ type: "pipeline:complete", result: pipelineResult });
  return ok(pipelineResult);
}

/**
 * Execute a stage with an additional tool (delegate) injected into its registry.
 */
async function executeStageWithDelegateTool(
  stageName: string,
  stageDef: StageDefinition,
  deps: ExecutorDeps,
  delegateTool: import("../../shared/types").ToolFunction,
): Promise<StageResult> {
  const start = Date.now();
  const { providers, contextStore, policyEngine, eventBus } = deps;

  if (deps.signal?.aborted) {
    return { stageName, status: "cancelled", durationMs: 0, contextKeysWritten: [] };
  }

  const provider = providers[stageDef.provider];
  if (!provider) {
    return { stageName, status: "failed", durationMs: Date.now() - start, error: `Provider "${stageDef.provider}" not found`, contextKeysWritten: [] };
  }

  eventBus.emit({ type: "stage:start", stageName, model: stageDef.model });

  // Seed lazy persistent context for the orchestrator too.
  await seedPersistentLazyContext(deps.workingDir, stageName, contextStore);

  // Build context
  const contextResult = await buildContextPayload(stageName, stageDef.context, contextStore, policyEngine, eventBus);
  if (!contextResult.ok) {
    eventBus.emit({ type: "stage:error", stageName, error: contextResult.error.message });
    return { stageName, status: "failed", durationMs: Date.now() - start, error: contextResult.error.message, contextKeysWritten: [] };
  }

  const { block: contextBlock, bytes: contextBytes } = formatContextForPrompt(
    contextResult.value,
    stageDef.context.eager === true,
  );

  // Load skill
  const skill = loadSkillDefinition(stageDef.skill, deps.skillsDir);

  // Orchestrator only gets the delegate tool — no filesystem tools.
  // If it could read/write files, it would do everything itself and never delegate.
  let delegated = false;
  const orchestratorRegistry = {
    definitions: () => [{ name: delegateTool.name, description: delegateTool.description, parameters: delegateTool.parameters }],
    execute: async (name: string, args: Record<string, unknown>) => {
      if (name === "delegate") {
        delegated = true;
        return delegateTool.execute(args).then((r) => r.ok ? ok(typeof r.value === "string" ? r.value : JSON.stringify(r.value)) : err(r.error));
      }
      return err(new ProviderError(`Tool "${name}" is not available to the orchestrator. Use delegate to assign work to agents.`, "API_ERROR"));
    },
  };

  // Build system prompt with persistent context
  const persistentCtx = loadStageContext(deps.workingDir, stageName);
  const persistentBlock = formatPersistentContext(persistentCtx);
  const persistentBytes = new TextEncoder().encode(persistentBlock).length;
  const basePrompt = stageDef.system_message
    ? `${skill.prompt ?? `You are the "${stageName}" orchestrator in an AI pipeline.`}\n\n--- Stage Instruction ---\n${stageDef.system_message}`
    : skill.prompt ?? `You are the "${stageName}" orchestrator in an AI pipeline.`;
  const systemPrompt = persistentBlock ? `${basePrompt}\n\n--- Persistent Context ---\n${persistentBlock}` : basePrompt;

  const request: ChatRequest = {
    model: stageDef.model,
    messages: [{
      role: "user",
      content: contextBlock
        ? `You must delegate the work to one of the available agents before you can conclude.\n\nComplete your task based on the following context.${contextBlock}`
        : "You must delegate the work to one of the available agents before you can conclude.\n\nComplete your task.",
    }],
    systemPrompt,
    maxTokens: stageDef.max_completion_tokens ? undefined : (stageDef.max_tokens ?? 16384),
    maxCompletionTokens: stageDef.max_completion_tokens,
    temperature: stageDef.temperature,
    tools: orchestratorRegistry.definitions(),
    timeoutMs: stageDef.timeout ? stageDef.timeout * 1000 : undefined,
  };

  const maxIterations = stageDef.max_iterations ?? 100;
  const loopResult = await runAgentLoop({
    provider,
    request,
    toolRegistry: orchestratorRegistry,
    maxIterations,
    eventBus,
    stageName,
    providerType: deps.config.providers[stageDef.provider]?.type,
    initialContextBytes: contextBytes,
    initialPersistentContextBytes: persistentBytes,
    signal: deps.signal,
    onTokenLimit: deps.onTokenLimit ? (summary) => deps.onTokenLimit!(stageName, summary) : undefined,
    requireToolCallOnFirstIteration: true,
  });

  if (!loopResult.ok) {
    eventBus.emit({ type: "stage:error", stageName, error: loopResult.error.message });
    return { stageName, status: "failed", durationMs: Date.now() - start, error: loopResult.error.message, contextKeysWritten: [] };
  }

  const agentResult = loopResult.value;
  if (!delegated) {
    const error =
      "Orchestrator finished without delegating any task. Ensure the model supports tool calling and that the orchestrator skill was loaded.";
    eventBus.emit({ type: "stage:error", stageName, error });
    return {
      stageName,
      status: "failed",
      durationMs: Date.now() - start,
      error,
      usage: agentResult.totalUsage,
      contextKeysWritten: [],
    };
  }

  const providerType = deps.config.providers[stageDef.provider]?.type ?? "openai-compatible";
  const cost = estimateStageCost(agentResult.totalUsage, stageDef.model, providerType);
  const costCheck = policyEngine.recordCost(cost, stageName);
  if (!costCheck.ok) {
    eventBus.emit({ type: "stage:error", stageName, error: costCheck.error.message });
    return { stageName, status: "failed", durationMs: Date.now() - start, error: costCheck.error.message, usage: agentResult.totalUsage, cost, contextKeysWritten: [] };
  }

  // Write orchestrator output to context
  const writeResult = await writeStageOutput(stageName, stageDef.context, agentResult.finalContent, contextStore, policyEngine, eventBus);
  const contextKeysWritten = writeResult.ok ? writeResult.value : [];

  const result: StageResult = {
    stageName,
    status: "success",
    output: agentResult.finalContent,
    usage: agentResult.totalUsage,
    breakdown: agentResult.breakdown,
    cost,
    durationMs: Date.now() - start,
    contextKeysWritten,
    stopReason: agentResult.stopReason,
    workSummary: agentResult.workSummary,
  };

  eventBus.emit({ type: "stage:complete", result });
  return result;
}

/**
 * Execute an entire pipeline: resolve DAG, run stages layer by layer.
 */
export async function executePipeline(deps: ExecutorDeps): Promise<Result<PipelineRunResult>> {
  // Route to orchestrated execution if mode is "orchestrated"
  if (deps.config.mode === "orchestrated") {
    return executeOrchestrated(deps);
  }

  const { config, eventBus } = deps;
  const runId = crypto.randomUUID();
  const start = Date.now();

  eventBus.emit({ type: "pipeline:start", pipelineName: config.name, runId });

  // Resolve execution order
  const orderResult = resolveExecutionOrder(config.stages);
  if (!orderResult.ok) return orderResult;

  const layers = orderResult.value;
  const stageResults: StageResult[] = [];
  let pipelineFailed = false;

  for (const layer of layers) {
    if (pipelineFailed || deps.signal?.aborted) {
      for (const name of layer) {
        stageResults.push({
          stageName: name,
          status: deps.signal?.aborted ? "cancelled" : "skipped",
          durationMs: 0,
          contextKeysWritten: [],
        });
      }
      continue;
    }

    const layerResults = await Promise.all(
      layer.map((name) => {
        const stageDef = config.stages[name] as StageDefinition;
        return executeStageWithRetry(name, stageDef, deps);
      }),
    );

    stageResults.push(...layerResults);

    if (layerResults.some((r) => r.status === "failed")) {
      pipelineFailed = true;
    }
  }

  const totalTokens: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  let totalCost = 0;

  for (const r of stageResults) {
    if (r.usage) {
      totalTokens.promptTokens += r.usage.promptTokens;
      totalTokens.completionTokens += r.usage.completionTokens;
      totalTokens.totalTokens += r.usage.totalTokens;
    }
    totalCost += r.cost ?? 0;
  }

  const allSuccess = stageResults.every((r) => r.status === "success");
  const anySuccess = stageResults.some((r) => r.status === "success");
  const wasCancelled = deps.signal?.aborted ?? false;

  const result: PipelineRunResult = {
    pipelineName: config.name,
    runId,
    status: wasCancelled ? "failed" : allSuccess ? "success" : anySuccess ? "partial" : "failed",
    stages: stageResults,
    totalDurationMs: Date.now() - start,
    totalCost,
    totalTokens,
  };

  eventBus.emit({ type: "pipeline:complete", result });
  return ok(result);
}
