import { useCallback, useEffect, useRef, useState } from "react";
import { Dag, type DagStage } from "../components/Dag";
import { Icons } from "../components/Icons";
import { useToast } from "../components/ToastProvider";
import { api, type PipelineEntry, type ProjectEntry, type RunRow } from "../lib/api";
import {
  formatDurationMs,
  formatMoney,
  formatRelative,
  formatTime,
  projectRun,
  RUN_EVENT_TYPES,
  runDuration,
  type RunEvent,
  type StageProjection,
} from "../lib/run-events";
import { subscribeRunStream, type RunStreamState } from "../lib/run-stream";
import {
  resolveSelectedWorkspaceProjectId,
  writeSelectedWorkspaceProjectId,
} from "../lib/workspace-selection";

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

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", fontSize: 12.5, padding: "4px 0" }}>
      <span style={{ color: "var(--fg-muted)", width: 100 }}>{k}</span>
      <span className={mono ? "mono" : undefined} style={{ color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}>{v}</span>
    </div>
  );
}

export function RunPipeline() {
  const { pushToast } = useToast();
  const wrapRef = useRef<HTMLDivElement>(null);
  const seenSeqsRef = useRef<Set<number>>(new Set());
  const [width, setWidth] = useState(1200);
  const [pipelines, setPipelines] = useState<PipelineEntry[]>([]);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [input, setInput] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunRow | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [active, setActive] = useState(false);
  const [cancellable, setCancellable] = useState(false);
  const [streamState, setStreamState] = useState<RunStreamState>("closed");
  const [busy, setBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState("all");

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const loadPipelines = useCallback(async () => {
    try {
      const [nextPipelines, nextProjects] = await Promise.all([
        api.listPipelines(),
        api.listProjects(),
      ]);
      setPipelines(nextPipelines);
      setProjects(nextProjects);
      setSelectedId((current) => current || nextPipelines[0]?.id || "");
      setSelectedProjectId((current) =>
        resolveSelectedWorkspaceProjectId(nextProjects, current),
      );
      setError(null);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not load pipelines", description: message });
    }
  }, [pushToast]);

  const loadRun = useCallback(async (id: string) => {
    try {
      const detail = await api.getRun(id);
      setRun(detail.run);
      setEvents(detail.events);
      setActive(detail.active);
      setCancellable(detail.cancellable);
      seenSeqsRef.current = new Set(detail.events.map((event) => event.seq));
      setError(null);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not load run", description: message });
    }
  }, [pushToast]);

  useEffect(() => {
    loadPipelines();
  }, [loadPipelines]);

  useEffect(() => {
    if (runId) loadRun(runId);
  }, [loadRun, runId]);

  useEffect(() => {
    if (!runId || !active) {
      setStreamState("closed");
      return;
    }

    return subscribeRunStream({
      runId,
      eventTypes: RUN_EVENT_TYPES,
      onStateChange: setStreamState,
      isTerminalEvent: (event) => event.type === "run:done" || event.type === "done",
      onEvent: (event) => {
        if (event.seq && seenSeqsRef.current.has(event.seq)) return;
        if (event.seq) seenSeqsRef.current.add(event.seq);
        if (event.type !== "done") {
          setEvents((current) => [...current, event]);
        }
        if (event.type === "run:done" || event.type === "done") {
          setActive(false);
          setCancellable(false);
          setCancelBusy(false);
          loadRun(runId);
        }
      },
    });
  }, [active, loadRun, runId]);

  const selectedPipeline = pipelines.find((pipeline) => pipeline.id === selectedId) ?? null;
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const projection = run ? projectRun(run, events) : null;
  const stages = projection?.stages ?? [];
  const activeStage = projection?.activeStageId ?? null;
  const stage = stages.find((item) => item.id === selectedStage) ?? stages[0] ?? null;
  const dagStages = toDagStages(stages);
  const logs = (projection?.eventLogs ?? []).filter((line) => logFilter === "all" || line.source === logFilter);

  useEffect(() => {
    if (!stages.length) {
      setSelectedStage(null);
      return;
    }
    if (!selectedStage || !stages.some((item) => item.id === selectedStage)) {
      setSelectedStage(activeStage ?? stages[0].id);
    }
  }, [activeStage, selectedStage, stages]);

  const showLeft = width >= 900;
  const showRight = width >= 1120;
  const cols = [showLeft ? "300px" : null, "1fr", showRight ? "320px" : null]
    .filter(Boolean)
    .join(" ");

  const start = async () => {
    if (!selectedPipeline) {
      setError("Register a pipeline before starting a run.");
      return;
    }
    if (!input.trim()) {
      setError("Input is required.");
      return;
    }
    if (projects.length > 0 && !selectedProject) {
      setError("Select a workspace before starting the run.");
      return;
    }
    setBusy(true);
    try {
      if (selectedProject) writeSelectedWorkspaceProjectId(selectedProject.id);
      const result = await api.runPipeline(selectedPipeline.id, input.trim(), {
        projectId: selectedProject?.id,
      });
      setRunId(result.runId);
      setRun(null);
      setEvents([]);
      seenSeqsRef.current = new Set();
      setStreamState("connecting");
      pushToast({ kind: "success", title: "Run started", description: result.runId });
      await loadRun(result.runId);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not start run", description: message });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!run) return;
    setCancelBusy(true);
    try {
      await api.cancelRun(run.id);
      pushToast({ kind: "info", title: "Cancellation requested" });
      await loadRun(run.id);
    } catch (e) {
      pushToast({ kind: "error", title: "Could not cancel run", description: (e as Error).message });
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <div ref={wrapRef} style={{ display: "grid", gridTemplateColumns: cols, height: "100%", minHeight: 0 }}>
      {showLeft && (
        <div style={{ borderRight: "1px solid var(--border)", padding: "20px 18px", overflowY: "auto" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fg-dim)", fontWeight: 600, marginBottom: 10 }}>Pipeline</div>
          <select
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            disabled={pipelines.length === 0 || busy}
            style={{
              width: "100%", padding: "10px 12px",
              background: "var(--bg-card)", border: "1px solid var(--border)",
              borderRadius: "var(--r-md)", color: "var(--fg)",
              fontSize: 13, fontFamily: "inherit", outline: "none",
            }}
          >
            {pipelines.length === 0 ? (
              <option value="">No registered pipelines</option>
            ) : (
              pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>
              ))
            )}
          </select>

          {selectedPipeline && (
            <div className="mono" style={{ marginTop: 10, fontSize: 11.5, color: "var(--fg-muted)", overflowWrap: "anywhere" }}>
              <div>{selectedPipeline.scope}</div>
              <div>{selectedPipeline.path}</div>
            </div>
          )}

          <div style={{ marginTop: 20, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fg-dim)", fontWeight: 600, marginBottom: 10 }}>Workspace</div>
          {projects.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.45 }}>
              No project workspaces registered. Runs use the pipeline location.
            </div>
          ) : (
            <>
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                disabled={busy}
                style={{
                  width: "100%", padding: "10px 12px",
                  background: "var(--bg-card)", border: "1px solid var(--border)",
                  borderRadius: "var(--r-md)", color: "var(--fg)",
                  fontSize: 13, fontFamily: "inherit", outline: "none",
                }}
              >
                <option value="">Select workspace...</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name} ({project.path})</option>
                ))}
              </select>
              {selectedProject && (
                <div className="mono" style={{ marginTop: 8, fontSize: 11.5, color: "var(--fg-muted)", overflowWrap: "anywhere" }}>
                  {selectedProject.path}
                </div>
              )}
            </>
          )}

          <div style={{ marginTop: 20, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fg-dim)", fontWeight: 600, marginBottom: 10 }}>Input</div>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Describe the input for the selected pipeline"
            style={{
              width: "100%", minHeight: 160, padding: "10px 12px",
              background: "var(--bg-card)", border: "1px solid var(--border)",
              borderRadius: "var(--r-md)", fontSize: 13, color: "var(--fg)",
              fontFamily: "inherit", resize: "vertical", outline: "none", lineHeight: 1.5,
            }}
          />

          <button
            type="button"
            onClick={start}
            disabled={busy || !selectedPipeline || !input.trim() || (projects.length > 0 && !selectedProject)}
            style={{
              marginTop: 22, width: "100%",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "10px 16px",
              background: busy || !selectedPipeline || !input.trim() ? "var(--bg-soft)" : "var(--cyan-500)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)", cursor: busy || !selectedPipeline || !input.trim() ? "not-allowed" : "pointer",
              fontSize: 13, color: busy || !selectedPipeline || !input.trim() ? "var(--fg-muted)" : "#fff",
              fontWeight: 500,
              fontFamily: "inherit",
            }}
          >
            {Icons.play} {busy ? "Starting..." : "Run pipeline"}
          </button>

          {cancellable && (
            <button
              type="button"
              onClick={cancel}
              disabled={cancelBusy}
              style={{
                marginTop: 10, width: "100%",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "10px 16px",
                background: "var(--bg-card)", border: "1px solid var(--border)",
                borderRadius: "var(--r-md)", cursor: cancelBusy ? "wait" : "pointer",
                fontSize: 13, color: "var(--err)", fontWeight: 500,
                fontFamily: "inherit",
              }}
            >
              {Icons.stop} {cancelBusy ? "Cancelling..." : "Stop current run"}
            </button>
          )}

          {error && (
            <div style={{ marginTop: 16, color: "var(--err)", fontSize: 12.5, lineHeight: 1.5 }}>{error}</div>
          )}
        </div>
      )}

      <div style={{ overflowY: "auto", padding: "20px 24px" }}>
        <div style={{
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: "var(--r-lg)", padding: 16, marginBottom: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                <span className={active ? "ot-pulse" : undefined} style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: run ? statusColor(run.status) : "var(--fg-dim)",
                }} />
                {run ? run.status : "Ready"} {run && <span className="mono" style={{ fontWeight: 400, color: "var(--fg-muted)" }}>{run.id.slice(0, 8)}</span>}
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 2 }}>
                {run
                  ? `${runDuration(run)} · ${stages.filter((item) => item.status === "success").length} of ${stages.length} stages complete · ${formatMoney(run.totalCost)} · stream:${streamState}`
                  : "Select a registered pipeline and provide input to start a run."}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: 6 }}>
              {run && (
                <button type="button" style={btnGhost} onClick={() => { window.location.hash = `#/runs/${run.id}`; }}>{Icons.eye}<span style={{ marginLeft: 6 }}>Open detail</span></button>
              )}
              <button type="button" style={btnGhost} onClick={loadPipelines}>{Icons.refresh}<span style={{ marginLeft: 6 }}>Pipelines</span></button>
            </div>
          </div>
          {dagStages.length > 0 ? (
            <Dag stages={dagStages} width={720} height={220} active={activeStage ?? undefined} onSelect={setSelectedStage} compact={dagStages.length > 6} />
          ) : (
            <div style={{ padding: "64px 16px", textAlign: "center", color: "var(--fg-muted)", fontSize: 13 }}>
              {run ? "Waiting for run events..." : "No run has been started from this screen."}
            </div>
          )}
        </div>

        <div style={{
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: "var(--r-lg)", overflow: "hidden",
        }}>
          <div style={{
            padding: "10px 14px", borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--fg-dim)" }}>{Icons.terminal}</span>
              Run events
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {["all", ...stages.map((item) => item.id)].map((filter) => (
                <button key={filter} type="button" onClick={() => setLogFilter(filter)} style={{
                  padding: "3px 10px", fontSize: 11.5,
                  background: logFilter === filter ? "var(--bg-soft)" : "transparent",
                  border: "1px solid",
                  borderColor: logFilter === filter ? "var(--border-strong)" : "transparent",
                  borderRadius: "var(--r-sm)", cursor: "pointer",
                  color: logFilter === filter ? "var(--fg)" : "var(--fg-muted)",
                  fontFamily: "inherit",
                }}>{filter}</button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>{events.length} events</span>
          </div>
          <div style={{
            padding: "10px 0", maxHeight: 420, overflowY: "auto",
            fontFamily: "var(--font-mono)", fontSize: 12,
          }}>
            {logs.length === 0 ? (
              <div style={{ padding: "10px 14px", color: "var(--fg-muted)" }}>No events to show.</div>
            ) : (
              logs.map((line, index) => (
                <div key={`${line.runId}-${line.ts}-${index}`} style={{ padding: "2px 14px", display: "flex", gap: 12, alignItems: "baseline" }}>
                  <span style={{ color: "var(--fg-dim)" }}>{formatTime(line.ts)}</span>
                  <span style={{
                    color: lvlColor[line.level] ?? "var(--fg-muted)",
                    width: 38, flexShrink: 0, textTransform: "uppercase",
                    fontSize: 10.5, fontWeight: 600,
                  }}>{line.level}</span>
                  <span style={{ color: "var(--fg-muted)", width: 86, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{line.source}</span>
                  <span style={{ color: "var(--fg)", flex: 1 }}>{line.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showRight && (
        <div style={{ borderLeft: "1px solid var(--border)", overflowY: "auto" }}>
          {stage ? (
            <StageInspector stage={stage} />
          ) : (
            <div style={{ padding: "18px", fontSize: 13, color: "var(--fg-muted)" }}>
              Select a stage after run events arrive.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StageInspector({ stage }: { stage: StageProjection }) {
  return (
    <>
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fg-dim)", fontWeight: 600, marginBottom: 6 }}>Selected stage</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={stage.status === "running" ? "ot-pulse" : undefined} style={{ width: 8, height: 8, borderRadius: 4, background: statusColor(stage.status) }} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>{stage.name}</div>
        </div>
        <div className="mono" style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 4 }}>
          {[stage.provider, stage.model].filter(Boolean).join(" · ") || stage.status}
        </div>
      </div>

      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
        <Row k="Status" v={stage.status} />
        <Row k="Iteration" v={stage.iteration == null ? "" : String(stage.iteration)} mono />
        <Row k="Tokens" v={stage.tokens == null ? "" : stage.tokens.toLocaleString()} mono />
        <Row k="Cost" v={stage.cost == null ? "" : formatMoney(stage.cost)} mono />
        <Row k="Duration" v={formatDurationMs(stage.durationMs)} mono />
      </div>

      <InspectorList title="Tools" values={stage.tools} />
      <InspectorList title="Context reads" values={stage.keysRead} />
      <InspectorList title="Context writes" values={stage.keysWritten} />
    </>
  );
}

function InspectorList({ title, values }: { title: string; values: string[] }) {
  return (
    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fg-dim)", fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {values.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>None recorded.</div>
      ) : (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {values.map((value) => (
            <span key={value} className="mono" style={{
              padding: "2px 6px", fontSize: 11,
              background: "var(--bg-soft)", color: "var(--cyan-700)",
              borderRadius: 3, border: "1px solid var(--border)",
            }}>{value}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function toDagStages(stages: StageProjection[]): DagStage[] {
  return stages.map((stage, index) => ({
    id: stage.id,
    label: stage.name,
    provider: stage.provider ?? "",
    model: stage.model ?? "",
    status: stage.status === "success" ? "done" : stage.status === "failed" ? "failed" : stage.status === "running" ? "running" : "pending",
    layer: index,
    duration: formatDurationMs(stage.durationMs),
  }));
}

function statusColor(status: RunRow["status"] | StageProjection["status"]): string {
  if (status === "success") return "var(--ok)";
  if (status === "failed") return "var(--err)";
  if (status === "cancelled") return "var(--warn)";
  if (status === "running") return "var(--cyan-500)";
  return "var(--fg-dim)";
}
