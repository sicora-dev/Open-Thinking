import { useEffect, useRef, useState } from "react";
import { Icons } from "../components/Icons";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/ToastProvider";
import { api, type RunRow } from "../lib/api";
import {
  formatDurationMs,
  formatMoney,
  formatTime,
  projectRun,
  RUN_EVENT_TYPES,
  runDuration,
  type RunEvent,
} from "../lib/run-events";
import { subscribeRunStream, type RunStreamState } from "../lib/run-stream";

const STATUS_COLOR: Record<string, string> = {
  running: "text-accent",
  success: "text-green-400",
  failed: "text-red-400",
  cancelled: "text-yellow-400",
};

export function RunDetail({ runId }: { runId: string }) {
  const { pushToast } = useToast();
  const [run, setRun] = useState<RunRow | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
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

    return subscribeRunStream({
      runId,
      eventTypes: RUN_EVENT_TYPES,
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

  const projection = run ? projectRun(run, events) : null;
  const stageEntries = projection?.stages ?? [];
  const selectedStageLog = selectedStage
    ? stageEntries.find((stage) => stage.id === selectedStage)?.logs ?? []
    : [];

  useEffect(() => {
    const firstStage = stageEntries[0]?.id ?? null;
    if (!firstStage) return;
    if (!selectedStage || !stageEntries.some((stage) => stage.id === selectedStage)) {
      setSelectedStage(firstStage);
    }
  }, [events, selectedStage, stageEntries]);

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
  const exportRun = () => {
    downloadText(
      buildRunExport(run, events),
      `openthk-run-${run.id.slice(0, 8)}.md`,
      "text/markdown;charset=utf-8",
    );
    pushToast({ kind: "success", title: "Run exported", description: `${events.length} events` });
  };

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
            <span>{(projection?.totalTokens ?? run.totalTokens).toLocaleString()} tok</span>
            <span>stream:{streamState}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={exportRun} title="Export run logs as Markdown">
            {Icons.file}
            <span className="ml-2">Export logs</span>
          </button>
          {cancellable && (
            <button className="btn" disabled={cancelBusy} onClick={cancel}>
              {cancelBusy ? "Cancelling…" : "Cancel run"}
            </button>
          )}
        </div>
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
                  key={s.id}
                  className={`px-4 py-2 border-b border-ink-700/50 flex items-center justify-between cursor-pointer ${
                    selectedStage === s.id ? "bg-ink-800" : "hover:bg-ink-800/70"
                  }`}
                  onClick={() => setSelectedStage(s.id)}
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
                    {s.durationMs != null ? formatDurationMs(s.durationMs) : ""}
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
                {events.map((e, index) => (
                  <div key={e.seq} className="text-ink-300">
                    <span className="text-ink-400">
                      [{formatTime(e.ts)}]
                    </span>{" "}
                    <span className="text-accent">{e.type}</span>{" "}
                    <span className="text-ink-400">
                      {projection?.eventLogs[index]?.message ?? summarizePayload(e.payload)}
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

function buildRunExport(run: RunRow, events: RunEvent[]): string {
  const projection = projectRun(run, events);
  const lines = [
    `# OpenThinking Run ${run.id}`,
    "",
    "## Summary",
    "",
    `- Pipeline: ${run.pipelineName}`,
    `- Status: ${run.status}`,
    `- Started: ${run.startedAt}`,
    `- Ended: ${run.endedAt ?? "running"}`,
    `- Duration: ${runDuration(run) || "n/a"}`,
    `- Total tokens: ${projection.totalTokens.toLocaleString()}`,
    `- Total cost: ${formatMoney(projection.totalCost)}`,
    `- Pipeline path: ${run.pipelinePath ?? "n/a"}`,
    "",
    "## Input",
    "",
    "```text",
    run.input,
    "```",
    "",
    "## Stages",
    "",
  ];

  if (projection.stages.length === 0) {
    lines.push("No stage events were recorded.", "");
  } else {
    lines.push("| Stage | Status | Duration | Tokens | Cost | Tools |");
    lines.push("| --- | --- | ---: | ---: | ---: | --- |");
    for (const stage of projection.stages) {
      lines.push(
        `| ${escapeMarkdownCell(stage.name)} | ${stage.status} | ${
          stage.durationMs == null ? "" : formatDurationMs(stage.durationMs)
        } | ${stage.tokens == null ? "" : stage.tokens.toLocaleString()} | ${
          stage.cost == null ? "" : formatMoney(stage.cost)
        } | ${escapeMarkdownCell(stage.tools.join(", "))} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Stage Logs", "");
  for (const stage of projection.stages) {
    lines.push(`### ${stage.name}`, "");
    if (stage.logs.length === 0) {
      lines.push("No log lines recorded for this stage.", "");
      continue;
    }
    lines.push("```text", ...stage.logs, "```", "");
  }

  lines.push("## Event Timeline", "");
  if (projection.eventLogs.length === 0) {
    lines.push("No events recorded.", "");
  } else {
    lines.push("```text");
    for (const line of projection.eventLogs) {
      lines.push(
        `[${line.ts}] ${line.level.toUpperCase()} ${line.source} ${line.type} - ${line.message}`,
      );
    }
    lines.push("```", "");
  }

  lines.push("## Raw Events", "", "```json", JSON.stringify(events, null, 2), "```", "");
  return lines.join("\n");
}

function downloadText(text: string, filename: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function summarizePayload(payload: unknown): string {
  if (!payload) return "";
  return JSON.stringify(payload).slice(0, 160);
}
