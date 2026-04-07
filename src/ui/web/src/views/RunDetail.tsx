import { useEffect, useRef, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/ToastProvider";
import { api, type RunRow } from "../lib/api";
import { subscribeRunStream, type RunStreamState } from "../lib/run-stream";

type Event = {
  seq: number;
  ts: string;
  type: string;
  payload: { seq?: number; ts?: string; payload?: unknown } | unknown;
};

type StageState = {
  name: string;
  status: "running" | "success" | "failed" | "cancelled";
  durationMs?: number;
  tokens?: number;
};

type EventPayload = Record<string, unknown> & {
  stageName?: string;
  error?: string;
  message?: string;
  key?: string;
  toolName?: string;
  success?: boolean;
  durationMs?: number;
  iteration?: number;
  usage?: { totalTokens?: number };
  result?: {
    stageName?: string;
    status?: string;
    durationMs?: number;
    usage?: { totalTokens?: number };
    error?: string;
  };
};

const STATUS_COLOR: Record<string, string> = {
  running: "text-accent",
  success: "text-green-400",
  failed: "text-red-400",
  cancelled: "text-yellow-400",
};

export function RunDetail({ runId }: { runId: string }) {
  const { pushToast } = useToast();
  const [run, setRun] = useState<RunRow | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [cancellable, setCancellable] = useState(false);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<RunStreamState>("closed");
  const [cancelBusy, setCancelBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const stageLogRef = useRef<HTMLDivElement>(null);
  const seenEventSeqsRef = useRef<Set<number>>(new Set());

  // Initial fetch
  useEffect(() => {
    api
      .getRun(runId)
      .then((r) => {
        setRun(r.run);
        setActive(r.active);
        setCancellable(r.cancellable);
        setEvents(r.events);
        seenEventSeqsRef.current = new Set(r.events.map((event) => event.seq));
      })
      .catch((e) => {
        const message = (e as Error).message;
        setError(message);
        pushToast({ kind: "error", title: "Could not load run", description: message });
      });
  }, [runId, pushToast]);

  // SSE stream
  useEffect(() => {
    if (!active) {
      setStreamState("closed");
      return;
    }

    const handlers: string[] = [
      "pipeline:start",
      "pipeline:complete",
      "stage:start",
      "stage:progress",
      "stage:complete",
      "stage:error",
      "stage:warning",
      "context:read",
      "context:write",
      "policy:violation",
      "tool:call",
      "tool:result",
      "delegate:start",
      "delegate:complete",
      "delegate:error",
      "tokens:update",
      "thinking:start",
      "thinking:end",
      "run:done",
      "run:error",
    ];

    return subscribeRunStream({
      runId,
      eventTypes: handlers,
      onStateChange: setStreamState,
      isTerminalEvent: (event) => event.type === "run:done",
      onEvent: (data) => {
        if (seenEventSeqsRef.current.has(data.seq)) return;
        seenEventSeqsRef.current.add(data.seq);
        setEvents((prev) => {
          return [...prev, { seq: data.seq, ts: data.ts, type: data.type, payload: data.payload }];
        });
        if (data.type === "run:done") {
          setActive(false);
          setCancellable(false);
          setCancelBusy(false);
          api
            .getRun(runId)
            .then((r) => {
              setRun(r.run);
              setCancellable(r.cancellable);
            })
            .catch(() => {});
          if (data.type === "run:done" && data.payload.status === "cancelled") {
            pushToast({ kind: "info", title: "Run cancelled" });
          }
        }
      },
    });
  }, [active, pushToast, runId]);

  const projection = projectEvents(events);
  const stageEntries = [...projection.stages.values()];
  const selectedStageLog = selectedStage ? projection.stageLogs[selectedStage] ?? [] : [];

  useEffect(() => {
    const firstStage = stageEntries[0]?.name ?? null;
    if (!firstStage) return;
    if (!selectedStage || !projection.stages.has(selectedStage)) {
      setSelectedStage(firstStage);
    }
  }, [events, selectedStage, projection.stages, stageEntries]);

  // Auto-scroll
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    if (stageLogRef.current) stageLogRef.current.scrollTop = stageLogRef.current.scrollHeight;
  }, [events.length, selectedStage]);

  const cancel = async () => {
    setCancelBusy(true);
    try {
      await api.cancelRun(runId);
      pushToast({ kind: "info", title: "Cancellation requested" });
    } catch (e) {
      const message = (e as Error).message;
      setCancelBusy(false);
      pushToast({ kind: "error", title: "Could not cancel run", description: message });
    }
  };

  if (error) {
    return (
      <EmptyState
        title="Run unavailable"
        description={error}
        action={
          <a href="#/runs" className="btn">
            Back to runs
          </a>
        }
      />
    );
  }
  if (!run) return <div className="p-6 text-ink-400 text-sm">Loading…</div>;

  const completedStages = stageEntries.filter((stage) => stage.status === "success").length;
  const failedStages = stageEntries.filter((stage) => stage.status === "failed").length;
  const runningStages = stageEntries.filter((stage) => stage.status === "running").length;

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-ink-700 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <a href="#/runs" className="text-ink-400 hover:text-ink-100 text-sm">
              ← Runs
            </a>
            <h1 className="text-lg font-medium">{run.pipelineName}</h1>
            <span className={`text-xs uppercase ${STATUS_COLOR[run.status] ?? ""}`}>
              {run.status}
            </span>
          </div>
          <p className="text-xs text-ink-400 mt-1 font-mono">{run.id}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-400 font-mono">
            <span>{completedStages}/{stageEntries.length || 0} complete</span>
            <span>{runningStages} running</span>
            <span>{failedStages} failed</span>
            <span>{projection.totalTokens.toLocaleString()} tok</span>
            <span>stream:{streamState}</span>
          </div>
        </div>
        {cancellable && (
          <button className="btn" disabled={cancelBusy} onClick={cancel}>
            {cancelBusy ? "Cancelling…" : "Cancel run"}
          </button>
        )}
      </header>

      <div className="flex-1 grid grid-cols-3 gap-0 overflow-hidden">
        {/* Stages panel */}
        <aside className="col-span-1 border-r border-ink-700 overflow-auto">
          <div className="px-4 py-2 label border-b border-ink-700">Stages</div>
          {stageEntries.length === 0 ? (
            <div className="p-4 text-ink-400 text-xs">Waiting for stages…</div>
          ) : (
            <ul>
              {stageEntries.map((s) => (
                <li
                  key={s.name}
                  className={`px-4 py-2 border-b border-ink-700/50 flex items-center justify-between cursor-pointer ${
                    selectedStage === s.name ? "bg-ink-800" : "hover:bg-ink-800/70"
                  }`}
                  onClick={() => setSelectedStage(s.name)}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 ${
                        s.status === "running"
                          ? "bg-accent animate-pulse"
                          : s.status === "success"
                            ? "bg-green-400"
                            : s.status === "failed"
                              ? "bg-red-400"
                              : "bg-yellow-400"
                      }`}
                    />
                    <span className="text-sm">{s.name}</span>
                  </div>
                  <div className="text-[11px] text-ink-400 font-mono">
                    {s.durationMs != null ? `${s.durationMs}ms` : ""}
                    {s.tokens ? ` · ${s.tokens}t` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Event log */}
        <section className="col-span-2 min-w-0 overflow-hidden">
          <div className="grid h-full" style={{ gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)" }}>
            <div className="min-h-0 border-b border-ink-700 flex flex-col">
              <div className="px-4 py-2 label border-b border-ink-700">
                {selectedStage ? `${selectedStage} log` : "Stage log"}
              </div>
              <div
                ref={stageLogRef}
                className="flex-1 overflow-auto font-mono text-[11px] p-4 space-y-1"
              >
                {selectedStageLog.map((line, index) => (
                  <div key={`${selectedStage}-${index}`} className="text-ink-300 whitespace-pre-wrap break-words">
                    {line}
                  </div>
                ))}
                {selectedStageLog.length === 0 && (
                  <div className="text-ink-400">
                    {selectedStage ? "No activity for this stage yet." : "Select a stage to inspect its activity."}
                  </div>
                )}
              </div>
            </div>

            <div className="min-h-0 flex flex-col">
              <div className="px-4 py-2 label border-b border-ink-700">Event log</div>
              <div ref={logRef} className="flex-1 overflow-auto font-mono text-[11px] p-4 space-y-1">
                {events.map((e) => (
                  <div key={e.seq} className="text-ink-300">
                    <span className="text-ink-400">
                      [{new Date(e.ts).toLocaleTimeString()}]
                    </span>{" "}
                    <span className="text-accent">{e.type}</span>{" "}
                    <span className="text-ink-400">
                      {summarize(e.type, e.payload)}
                    </span>
                  </div>
                ))}
                {events.length === 0 && (
                  <div className="text-ink-400">No events yet.</div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function projectEvents(events: Event[]): {
  stages: Map<string, StageState>;
  stageLogs: Record<string, string[]>;
  totalTokens: number;
} {
  const stages = new Map<string, StageState>();
  const stageLogs: Record<string, string[]> = {};
  let totalTokens = 0;

  for (const event of events) {
    const payload = event.payload as EventPayload;
    const stageName = getStageName(event.type, payload);
    if (stageName && !stageLogs[stageName]) {
      stageLogs[stageName] = [];
    }

    if (event.type === "stage:start" && payload.stageName) {
      stages.set(payload.stageName, { name: payload.stageName, status: "running" });
    }

    if (event.type === "stage:complete" && payload.result?.stageName) {
      const result = payload.result;
      const resultStageName = result.stageName;
      if (!resultStageName) continue;
      stages.set(resultStageName, {
        name: resultStageName,
        status: (result.status as StageState["status"]) ?? "success",
        durationMs: result.durationMs,
        tokens: result.usage?.totalTokens,
      });
    }

    if (event.type === "stage:error" && payload.stageName) {
      const current = stages.get(payload.stageName);
      stages.set(payload.stageName, {
        name: payload.stageName,
        status: "failed",
        durationMs: current?.durationMs,
        tokens: current?.tokens,
      });
    }

    if (event.type === "tokens:update") {
      totalTokens = Math.max(totalTokens, payload.usage?.totalTokens ?? 0);
      if (payload.stageName) {
        const current = stages.get(payload.stageName) ?? {
          name: payload.stageName,
          status: "running",
        };
        stages.set(payload.stageName, {
          ...current,
          tokens: payload.usage?.totalTokens ?? current.tokens,
        });
      }
    }

    const stageLine = summarizeStageEvent(event.type, payload);
    if (stageName && stageLine) {
      stageLogs[stageName]?.push(
        `[${new Date(event.ts).toLocaleTimeString()}] ${stageLine}`,
      );
    }
  }

  return { stages, stageLogs, totalTokens };
}

function getStageName(type: string, payload: EventPayload): string | null {
  if (payload.stageName) return payload.stageName;
  if (type === "stage:complete" && payload.result?.stageName) return payload.result.stageName;
  if (type === "delegate:start" && typeof payload.agentName === "string") return payload.agentName;
  if (type === "delegate:complete" && typeof payload.agentName === "string") return payload.agentName;
  if (type === "delegate:error" && typeof payload.agentName === "string") return payload.agentName;
  return null;
}

function summarizeStageEvent(type: string, payload: EventPayload): string | null {
  if (type === "stage:start") return `started on ${payload.model}`;
  if (type === "stage:progress") return JSON.stringify(payload.chunk ?? {}).slice(0, 160);
  if (type === "stage:complete") {
    return `completed ${payload.result?.status ?? "success"} in ${payload.result?.durationMs ?? 0}ms`;
  }
  if (type === "stage:error") return `error: ${payload.error}`;
  if (type === "stage:warning") return `warning: ${payload.message}`;
  if (type === "context:read") return `read ${payload.key}`;
  if (type === "context:write") return `wrote ${payload.key}`;
  if (type === "policy:violation") return `policy violation: ${payload.rule} (${payload.detail})`;
  if (type === "tool:call") return `tool → ${payload.toolName}`;
  if (type === "tool:result") {
    const status = payload.success ? "ok" : "error";
    return `tool ← ${payload.toolName} ${status} ${payload.durationMs ?? 0}ms`;
  }
  if (type === "tokens:update") {
    return `tokens ${payload.usage?.totalTokens ?? 0} at iter ${payload.iteration ?? 0}`;
  }
  if (type === "thinking:start") return "waiting for model response";
  if (type === "thinking:end") return "response received";
  return null;
}

function summarize(type: string, payload: unknown): string {
  const p = payload as EventPayload;
  if (!p) return "";
  if (type === "stage:start") return `${p.stageName} (${p.model})`;
  if (type === "stage:complete") {
    const r = p.result;
    return `${r?.stageName ?? ""} ${r?.status ?? ""} ${r?.durationMs ?? ""}ms`;
  }
  if (type === "stage:error") return `${p.stageName}: ${p.error}`;
  if (type === "stage:warning") return `${p.stageName}: ${p.message}`;
  if (type === "context:read") return `${p.stageName} read ${p.key}`;
  if (type === "context:write") return `${p.stageName} wrote ${p.key}`;
  if (type === "policy:violation") return `${p.stageName} ${p.rule}: ${p.detail}`;
  if (type === "tool:call") return `${p.stageName} → ${p.toolName}`;
  if (type === "tool:result") return `${p.stageName} ← ${p.toolName} ${p.success ? "ok" : "err"}`;
  if (type === "thinking:start") return `${p.stageName} waiting for model`;
  if (type === "thinking:end") return `${p.stageName} response received`;
  if (type === "run:done") return `status=${p.status} tokens=${p.totalTokens}`;
  return JSON.stringify(p).slice(0, 120);
}
