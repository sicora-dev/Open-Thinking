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
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createContextStore } from "../../context/store";
import { createEventBus } from "../../core/events/event-bus";
import { createPermissionEngine } from "../../core/permissions";
import type { PermissionMode } from "../../core/permissions";
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

type ErrorRecoveryGate = {
  stageName: string;
  error: string;
  resolve: (action: "retry" | "skip" | "abort") => void;
};

type ActiveRun = {
  runId: string;
  controller: AbortController;
  seq: number;
  startedAtMs: number;
  subscribers: Set<(evt: RunEvent) => void>;
  permissionEngine?: import("../../core/permissions").PermissionEngine;
  pendingErrorRecovery?: ErrorRecoveryGate;
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

/**
 * Resolve a pending permission request for an active run.
 * Returns true if the request was found and resolved.
 */
export function resolvePermission(
  runId: string,
  requestId: string,
  action: "allow" | "deny",
  remember: boolean,
): boolean {
  const a = active.get(runId);
  if (!a?.permissionEngine) return false;
  return a.permissionEngine.confirmations().resolve(requestId, { action, remember });
}

/**
 * Resolve a pending error recovery decision for an active run.
 */
export function resolveErrorRecovery(
  runId: string,
  action: "retry" | "skip" | "abort",
): boolean {
  const a = active.get(runId);
  if (!a?.pendingErrorRecovery) return false;
  a.pendingErrorRecovery.resolve(action);
  a.pendingErrorRecovery = undefined;
  return true;
}

/**
 * Get the pending error recovery state for an active run, if any.
 */
export function getPendingErrorRecovery(runId: string): { stageName: string; error: string } | null {
  const a = active.get(runId);
  if (!a?.pendingErrorRecovery) return null;
  return { stageName: a.pendingErrorRecovery.stageName, error: a.pendingErrorRecovery.error };
}

/**
 * List pending permission requests for an active run.
 */
export function listPendingPermissions(runId: string): Array<{
  id: string;
  tool: string;
  risk: string;
  description: string;
  subject: string;
}> {
  const a = active.get(runId);
  if (!a?.permissionEngine) return [];
  return a.permissionEngine.confirmations().pending().map((p) => ({
    id: p.request.id,
    tool: p.request.tool,
    risk: p.request.risk,
    description: p.request.description,
    subject: p.request.subject,
  }));
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

  if (!inputArgs.workspace) {
    return err(
      new Error(
        "Workspace is required for UI runs. Select a project workspace before starting the pipeline.",
      ),
    );
  }

  if (
    inputArgs.entry.scope === "project" &&
    inputArgs.entry.projectId &&
    inputArgs.workspace.projectId !== inputArgs.entry.projectId
  ) {
    return err(
      new Error(
        "Project pipelines must run in their own project workspace.",
      ),
    );
  }

  const workspacePath = inputArgs.workspace.path;
  if (!workspacePath || !isAbsolute(workspacePath)) {
    return err(new Error("Workspace path must be an absolute path."));
  }

  const workingDir = resolve(workspacePath);
  if (!existsSync(workingDir)) {
    return err(new Error(`Workspace path does not exist: ${workingDir}`));
  }
  if (!statSync(workingDir).isDirectory()) {
    return err(new Error(`Workspace path is not a directory: ${workingDir}`));
  }

  const contextStore = createContextStore({
    dbPath: hasProjectWorkspace(workingDir)
      ? join(getProjectDir(workingDir), "context.db")
      : ":memory:",
  });
  await contextStore.set("input.prompt", inputArgs.input, "user");

  const skillsDir = getProjectSkillsDir(workingDir);

  // Create permission engine for this run (UI resolves via POST /api/runs/:id/permission)
  const permissionMode: PermissionMode = (config.permissions as PermissionMode) ?? "confirm";
  const permissionEngine = createPermissionEngine({
    mode: permissionMode,
    workingDir,
    eventBus,
  });
  runState.permissionEngine = permissionEngine;

  // Error recovery callback for UI: blocks until the UI posts an action
  async function onStageError(stageName: string, error: string): Promise<"retry" | "skip" | "abort"> {
    return new Promise<"retry" | "skip" | "abort">((resolve) => {
      runState.pendingErrorRecovery = { stageName, error, resolve };
      emitRunEvent(runState, "stage:error-paused", { stageName, error });
    });
  }

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
        permissionEngine,
        onStageError,
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
