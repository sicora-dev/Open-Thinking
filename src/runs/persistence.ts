import type { EventBus } from "../core/events/event-bus";
import type { PipelineRunResult } from "../shared/types";
import {
  appendEvent,
  createRun,
  finalizeRun,
  type RunStatus,
} from "../ui/server/runs-store";

export type PersistedRunTracker = {
  runId: string;
  finishFromResult: (result: PipelineRunResult, wasCancelled?: boolean) => void;
  finishWithError: (error: string, wasCancelled?: boolean) => void;
  close: () => void;
};

export function createPersistedRunTracker(input: {
  eventBus: EventBus;
  pipelineName: string;
  pipelinePath: string | null;
  prompt: string;
}): PersistedRunTracker {
  const runId = crypto.randomUUID();
  const startedAtMs = Date.now();
  let seq = 0;
  let closed = false;

  createRun({
    id: runId,
    pipelineName: input.pipelineName,
    pipelinePath: input.pipelinePath,
    input: input.prompt,
  });

  const unsubscribe = input.eventBus.onAny((event) => {
    appendEvent(runId, ++seq, event.type, event);
  });

  const finish = (
    status: RunStatus,
    totals: { tokens: number; cost: number },
    error?: string,
  ) => {
    if (closed) return;
    closed = true;

    if (error && status === "failed") {
      appendEvent(runId, ++seq, "run:error", { error });
    }
    finalizeRun(runId, status, totals);
    appendEvent(runId, ++seq, "run:done", {
      status,
      totalTokens: totals.tokens,
      totalCost: totals.cost,
      durationMs: Date.now() - startedAtMs,
      ...(error ? { error } : {}),
    });
    unsubscribe();
  };

  return {
    runId,
    finishFromResult(result, wasCancelled = false) {
      const status: RunStatus =
        wasCancelled
          ? "cancelled"
          : result.status === "success"
            ? "success"
            : "failed";
      finish(status, {
        tokens: result.totalTokens.totalTokens,
        cost: result.totalCost,
      });
    },
    finishWithError(error, wasCancelled = false) {
      finish(wasCancelled ? "cancelled" : "failed", { tokens: 0, cost: 0 }, error);
    },
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
    },
  };
}
