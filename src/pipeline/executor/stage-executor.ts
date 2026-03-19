/**
 * Stage executor: runs pipeline stages in DAG order.
 * Handles sequential/parallel execution, context I/O, policy enforcement,
 * and failure routing (retry, re-route).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { EventBus } from "../../core/events/event-bus";
import type { PolicyEngine } from "../../policies/engine";
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
import { createToolRegistry } from "../../tools";
import { runAgentLoop } from "./agent-loop";

export type ExecutorDeps = {
  config: PipelineConfig;
  providers: Record<string, LLMProvider>;
  contextStore: ContextStore;
  policyEngine: PolicyEngine;
  eventBus: EventBus;
  /** Base directory for resolving skill paths. Defaults to cwd. */
  skillsDir?: string;
  /** Abort signal for cancellation support. */
  signal?: AbortSignal;
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
 * Format context as a string block for the LLM prompt.
 */
function formatContextForPrompt(context: Record<string, string>): string {
  if (Object.keys(context).length === 0) return "";
  const lines = Object.entries(context).map(([key, value]) => `[${key}]\n${value}`);
  return `\n\n--- Context ---\n${lines.join("\n\n")}\n--- End Context ---`;
}

type LoadedSkill = {
  prompt: string | null;
  allowedTools: string[] | null;
};

/**
 * Load a skill's prompt.md and skill.yaml. Skill references look like "core/arch-planner@1.0".
 * We resolve to: <skillsDir>/<namespace>/<name>/
 *
 * The skill.yaml defines allowed_tools — the default tool permissions for this skill type.
 * A planner skill only gets read tools, a coder gets everything, etc.
 */
function loadSkill(skillRef: string, skillsDir: string): LoadedSkill {
  // Parse "namespace/name@version" or just "name"
  const withoutVersion = skillRef.split("@")[0] ?? skillRef;
  const parts = withoutVersion.split("/");
  const first = parts[0] ?? withoutVersion;
  const skillDir =
    parts.length >= 2
      ? join(skillsDir, first, parts.slice(1).join("/"))
      : join(skillsDir, first);

  // Load prompt.md
  const promptPath = join(skillDir, "prompt.md");
  const prompt = existsSync(promptPath) ? readFileSync(promptPath, "utf-8").trim() : null;

  // Load skill.yaml manifest for tool permissions
  let allowedTools: string[] | null = null;
  const manifestPath = join(skillDir, "skill.yaml");
  if (existsSync(manifestPath)) {
    try {
      const raw = parseYaml(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
      if (Array.isArray(raw.allowed_tools)) {
        allowedTools = raw.allowed_tools as string[];
      }
    } catch {
      // If manifest is malformed, fall back to defaults
    }
  }

  return { prompt, allowedTools };
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

  const contextBlock = formatContextForPrompt(contextResult.value);

  // Load skill prompt + manifest (tool permissions)
  const skillsDir = deps.skillsDir ?? join(process.cwd(), "skills");
  const skill = loadSkill(stageDef.skill, skillsDir);

  // Resolve tool permissions: stage YAML overrides > skill manifest > all tools
  const allowedTools = stageDef.allowed_tools ?? skill.allowedTools ?? undefined;
  const toolRegistry = createToolRegistry(process.cwd(), allowedTools);

  // Build chat request
  const systemPrompt = skill.prompt ?? `You are the "${stageName}" stage in an AI pipeline.`;
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
    maxTokens: stageDef.max_tokens,
    temperature: stageDef.temperature,
    tools: toolRegistry.definitions(),
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
    signal: deps.signal,
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
  const cost = estimateCost(agentResult.totalUsage);
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
    cost,
    durationMs: Date.now() - start,
    contextKeysWritten,
  };

  eventBus.emit({ type: "stage:complete", result });
  return result;
}

/**
 * Rough cost estimate based on token usage. Real pricing would need model-specific rates.
 */
function estimateCost(usage: TokenUsage): number {
  // Approximate: $0.01 per 1K tokens (placeholder)
  return (usage.totalTokens / 1000) * 0.01;
}

/**
 * Execute a stage with retry support based on on_fail config.
 */
async function executeStageWithRetry(
  stageName: string,
  stageDef: StageDefinition,
  deps: ExecutorDeps,
): Promise<StageResult> {
  let result = await executeStage(stageName, stageDef, deps);

  if (result.status === "failed" && stageDef.on_fail) {
    const { max_retries, inject_context } = stageDef.on_fail;

    for (let attempt = 0; attempt < max_retries && result.status === "failed"; attempt++) {
      // Inject failure context if configured
      if (inject_context && result.error) {
        await deps.contextStore.set(inject_context, result.error, stageName);
      }

      result = await executeStage(stageName, stageDef, deps);
    }
  }

  return result;
}

/**
 * Execute an entire pipeline: resolve DAG, run stages layer by layer.
 */
export async function executePipeline(deps: ExecutorDeps): Promise<Result<PipelineRunResult>> {
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
      // Skip remaining stages
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

    // Run stages in the layer in parallel
    const layerResults = await Promise.all(
      layer.map((name) => {
        const stageDef = config.stages[name] as StageDefinition;
        return executeStageWithRetry(name, stageDef, deps);
      }),
    );

    stageResults.push(...layerResults);

    // Check if any stage in this layer failed
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
