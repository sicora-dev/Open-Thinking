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

const btnGhost: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 10px",
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  cursor: "pointer",
  fontSize: 12.5,
  color: "var(--fg)",
  fontFamily: "inherit",
  textDecoration: "none",
};

const panelStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-lg)",
  overflow: "hidden",
};

const lvlColor: Record<string, string> = {
  info: "var(--fg-muted)",
  tool: "var(--cyan-600)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  err: "var(--err)",
  ctx: "#8b5cf6",
  model: "#f59e0b",
};

function statusColor(status: RunRow["status"]): string {
  if (status === "running") return "var(--cyan-500)";
  if (status === "success") return "var(--ok)";
  if (status === "failed") return "var(--err)";
  return "var(--warn)";
}

export function RunDetail({ runId, from }: { runId: string; from?: string }) {
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
      const result = await api.cancelRun(runId);
      if (!result.ok) throw new Error("Run is not active in this UI process.");
      pushToast({
        kind: "info",
        title: result.stale ? "Run marked cancelled" : "Cancellation requested",
        description: result.stale ? "The worker process was no longer active." : undefined,
      });
      const detail = await api.getRun(runId);
      setRun(detail.run);
      setActive(detail.active);
      setCancellable(detail.cancellable);
    } catch (e) {
      const message = (e as Error).message;
      pushToast({ kind: "error", title: "Could not cancel run", description: message });
    } finally {
      setCancelBusy(false);
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
  const backTarget = from === "run" ? `#/run?runId=${run.id}` : from === "logs" ? "#/logs" : "#/runs";
  const backLabel = from === "run" ? "Run pipeline" : from === "logs" ? "Logs" : "Runs";
  const simpleLogsTarget = `#/run?runId=${run.id}`;
  const canRequestStop = run.status === "running" || cancellable;
  const exportRun = () => {
    downloadText(
      buildRunExport(run, events),
      `openthk-run-${run.id.slice(0, 8)}.md`,
      "text/markdown;charset=utf-8",
    );
    pushToast({ kind: "success", title: "Run exported", description: `${events.length} events` });
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "20px 24px" }}>
      <div style={{ ...panelStyle, padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <a
                href={backTarget}
                style={{ color: "var(--fg-muted)", fontSize: 13, textDecoration: "none" }}
              >
                ← {backLabel}
              </a>
              <span
                className={run.status === "running" ? "ot-pulse" : undefined}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: statusColor(run.status),
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{run.status}</span>
              <span className="mono" style={{ color: "var(--fg-muted)", fontSize: 12 }}>
                {run.id.slice(0, 8)}
              </span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {run.pipelineName}
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 4 }}>
              {runDuration(run)} · {completedStages} of {stageEntries.length || 0} stages complete · {runningStages} running · {failedStages} failed · {(projection?.totalTokens ?? run.totalTokens).toLocaleString()} tok · stream:{streamState}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <a style={btnGhost} href={simpleLogsTarget} title="Open this run in the simple execution log view">
              {Icons.terminal}<span style={{ marginLeft: 6 }}>Simple logs</span>
            </a>
            <button type="button" style={btnGhost} onClick={exportRun} title="Export run logs as Markdown">
              {Icons.file}<span style={{ marginLeft: 6 }}>Export logs</span>
            </button>
            {canRequestStop && (
              <button
                type="button"
                style={{ ...btnGhost, color: "var(--err)" }}
                disabled={cancelBusy}
                onClick={cancel}
                title="Stop this run"
              >
                {Icons.stop}<span style={{ marginLeft: 6 }}>{cancelBusy ? "Stopping..." : "Stop run"}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)", gap: 16, minHeight: 0 }}>
        <aside style={{ ...panelStyle, alignSelf: "start" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 12.5, fontWeight: 600 }}>
            Stages
          </div>
          {stageEntries.length === 0 ? (
            <div style={{ padding: 14, color: "var(--fg-muted)", fontSize: 12 }}>Waiting for stages...</div>
          ) : (
            <div>
              {stageEntries.map((stage) => (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => setSelectedStage(stage.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 14px",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    background: selectedStage === stage.id ? "var(--bg-soft)" : "transparent",
                    color: "var(--fg)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span
                      className={stage.status === "running" ? "ot-pulse" : undefined}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        background: stage.status === "running" ? "var(--cyan-500)" : statusColor(stage.status as RunRow["status"]),
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {stage.name}
                    </span>
                  </span>
                  <span className="mono" style={{ color: "var(--fg-muted)", fontSize: 11.5, flexShrink: 0 }}>
                    {stage.durationMs != null ? formatDurationMs(stage.durationMs) : ""}
                    {stage.tokens ? ` · ${stage.tokens}t` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section style={{ display: "grid", gap: 16, minWidth: 0 }}>
          <div style={{ ...panelStyle, minHeight: 280, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--fg-dim)" }}>{Icons.terminal}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                {selectedStage ? `${selectedStage} log` : "Stage log"}
              </span>
            </div>
            <div
              ref={stageLogRef}
              style={{
                flex: 1,
                minHeight: 0,
                maxHeight: 360,
                overflowY: "auto",
                padding: "12px 14px",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            >
              {selectedStageLog.length === 0 ? (
                <div style={{ color: "var(--fg-muted)" }}>
                  {selectedStage ? "No activity for this stage yet." : "Select a stage to inspect its activity."}
                </div>
              ) : (
                selectedStageLog.map((line, index) => (
                  <div key={`${selectedStage}-${index}`} style={{ color: "var(--fg)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: "1px 0" }}>
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ ...panelStyle, minHeight: 360, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--fg-dim)" }}>{Icons.terminal}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Event log</span>
              <div style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>{events.length} events</span>
            </div>
            <div
              ref={logRef}
              style={{
                flex: 1,
                minHeight: 0,
                maxHeight: 460,
                overflowY: "auto",
                padding: "12px 14px",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
            >
              {events.length === 0 ? (
                <div style={{ color: "var(--fg-muted)" }}>No events yet.</div>
              ) : (
                events.map((event, index) => {
                  const line = projection?.eventLogs[index];
                  return (
                    <div key={event.seq} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "1px 0" }}>
                      <span style={{ color: "var(--fg-dim)", flexShrink: 0 }}>{formatTime(event.ts)}</span>
                      <span
                        style={{
                          color: lvlColor[line?.level ?? "info"] ?? "var(--fg-muted)",
                          width: 42,
                          flexShrink: 0,
                          textTransform: "uppercase",
                          fontSize: 10.5,
                          fontWeight: 600,
                        }}
                      >
                        {line?.level ?? event.type}
                      </span>
                      <span style={{ color: "var(--fg-muted)", width: 104, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {line?.source ?? ""}
                      </span>
                      <span style={{ color: "var(--fg)", flex: 1, overflowWrap: "anywhere" }}>
                        {line?.message ?? summarizePayload(event.payload)}
                      </span>
                    </div>
                  );
                })
              )}
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
