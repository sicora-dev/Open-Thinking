/**
 * Run manager: bridges the pipeline executor to the UI.
 *
 * Responsibilities:
 *   - Spin up a real pipeline run from a registered pipeline + user input.
 *   - Persist every event into runs.db (so reconnecting clients can replay).
 *   - Fan out events to live SSE subscribers.
 *   - Track AbortControllers so /api/runs/:id/cancel can stop a run.
 *
 * The actual heavy work (providers, executor, context store) is reused
 * from the existing CLI run command — this is just the orchestration layer
 * that makes it usable from HTTP.
 */
import { dirname, join } from "node:path";
import { getOpenthkConfigDir } from "../../config/paths";
import { createContextStore } from "../../context/store";
import { createEventBus } from "../../core/events/event-bus";
import { executePipeline } from "../../pipeline/executor";
import { parsePipeline } from "../../pipeline/parser";
import { createPolicyEngine } from "../../policies/engine";
import { createProviderFromConfig } from "../../providers";
import { type Result, err, ok } from "../../shared/result";
import type { LLMProvider, PipelineEvent } from "../../shared/types";
import { getProjectDir, hasProjectWorkspace } from "../../workspace";
import {
  type PipelineIndexEntry,
  touchPipeline,
} from "./pipelines-index";
import { appendEvent, createRun, finalizeRun } from "./runs-store";
import { getProjectSkillsDir } from "./skills-store";

export type RunEvent = {
  seq: number;
  ts: string;
  type: string;
  payload: unknown;
};

type ActiveRun = {
  runId: string;
  controller: AbortController;
  seq: number;
  startedAtMs: number;
  subscribers: Set<(evt: RunEvent) => void>;
};

const active = new Map<string, ActiveRun>();

export function isRunActive(runId: string): boolean {
  return active.has(runId);
}

export function subscribeRun(runId: string, fn: (evt: RunEvent) => void): () => void {
  const a = active.get(runId);
  if (!a) return () => {};
  a.subscribers.add(fn);
  return () => a.subscribers.delete(fn);
}

export function cancelRun(runId: string): boolean {
  const a = active.get(runId);
  if (!a) return false;
  a.controller.abort();
  return true;
}

function emitRunEvent(run: ActiveRun, type: string, payload: unknown): void {
  run.seq += 1;
  const evt: RunEvent = {
    seq: run.seq,
    ts: new Date().toISOString(),
    type,
    payload,
  };
  appendEvent(run.runId, evt.seq, type, payload);
  for (const sub of run.subscribers) {
    try {
      sub(evt);
    } catch {
      // ignore subscriber errors
    }
  }
}

function finishRun(
  run: ActiveRun,
  status: "success" | "failed" | "cancelled",
  totals: { tokens: number; cost: number },
  error?: string,
): void {
  if (error && status === "failed") {
    emitRunEvent(run, "run:error", { error });
  }

  finalizeRun(run.runId, status, totals);
  emitRunEvent(run, "run:done", {
    status,
    totalTokens: totals.tokens,
    totalCost: totals.cost,
    durationMs: Date.now() - run.startedAtMs,
    ...(error ? { error } : {}),
  });
}

export type StartRunInput = {
  entry: PipelineIndexEntry;
  input: string;
  workspace?: {
    projectId: string;
    path: string;
  } | null;
};

export async function startRun(
  inputArgs: StartRunInput,
): Promise<Result<{ runId: string }>> {
  const parseResult = await parsePipeline(inputArgs.entry.path);
  if (!parseResult.ok) {
    return err(new Error(`Pipeline parse failed: ${parseResult.error.message}`));
  }
  const config = parseResult.value;

  // Build providers
  const providers: Record<string, LLMProvider> = {};
  for (const [name, providerConfig] of Object.entries(config.providers)) {
    const r = createProviderFromConfig(name, providerConfig);
    if (!r.ok) return err(new Error(`Provider "${name}": ${r.error.message}`));
    providers[name] = r.value;
  }

  const policyResult = createPolicyEngine(config.policies.global);
  if (!policyResult.ok) return err(new Error(`Policy: ${policyResult.error.message}`));

  const runId = crypto.randomUUID();
  createRun({
    id: runId,
    pipelineName: config.name,
    pipelinePath: inputArgs.entry.path,
    input: inputArgs.input,
  });
  touchPipeline(inputArgs.entry.id);

  const controller = new AbortController();
  const runState: ActiveRun = {
    runId,
    controller,
    seq: 0,
    startedAtMs: Date.now(),
    subscribers: new Set(),
  };
  active.set(runId, runState);

  const eventBus = createEventBus();
  eventBus.onAny((evt: PipelineEvent) => {
    emitRunEvent(runState, evt.type, evt);
  });

  const workingDir = inputArgs.workspace?.path ?? (inputArgs.entry.rootPath || dirname(inputArgs.entry.path));
  const contextStore = createContextStore({
    dbPath: hasProjectWorkspace(workingDir)
      ? join(getProjectDir(workingDir), "context.db")
      : ":memory:",
  });
  await contextStore.set("input.prompt", inputArgs.input, "user");

  const skillsDir =
    inputArgs.workspace || inputArgs.entry.scope === "project"
      ? getProjectSkillsDir(workingDir)
      : join(getOpenthkConfigDir(), "skills");

  // Run in the background — do NOT await before returning.
  (async () => {
    try {
      const result = await executePipeline({
        config,
        providers,
        contextStore,
        policyEngine: policyResult.value,
        eventBus,
        workingDir,
        skillsDir,
        signal: controller.signal,
      });

      if (!result.ok) {
        finishRun(
          runState,
          controller.signal.aborted ? "cancelled" : "failed",
          { tokens: 0, cost: 0 },
          result.error.message,
        );
      } else {
        const run = result.value;
        const finalStatus =
          run.status === "success"
            ? "success"
            : controller.signal.aborted
              ? "cancelled"
              : "failed";
        finishRun(runState, finalStatus, {
          tokens: run.totalTokens.totalTokens,
          cost: run.totalCost,
        });
      }
    } catch (e) {
      finishRun(runState, controller.signal.aborted ? "cancelled" : "failed", { tokens: 0, cost: 0 }, (e as Error).message);
    } finally {
      contextStore.close();
      active.delete(runId);
    }
  })();

  return ok({ runId });
}
