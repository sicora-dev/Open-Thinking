import { useCallback, useEffect, useState } from "react";
import { Dag, type DagStage } from "../components/Dag";
import { Icons } from "../components/Icons";
import { useToast } from "../components/ToastProvider";
import { api, type PipelineEntry, type ProviderInfo, type RunRow } from "../lib/api";
import {
  formatDurationMs,
  formatMoney,
  formatRelative,
  projectRun,
  runDuration,
  type RunEvent,
} from "../lib/run-events";

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

function Card({ children, style, pad = 16 }: { children: React.ReactNode; style?: React.CSSProperties; pad?: number }) {
  return (
    <div style={{
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--r-lg)",
      padding: pad,
      boxShadow: "var(--shadow-sm)",
      ...style,
    }}>
      {children}
    </div>
  );
}

function Stat({ label, value, unit, accent }: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <div style={{ fontSize: 12, color: "var(--fg-muted)", fontWeight: 500 }}>{label}</div>
      <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", gap: 4 }}>
        <span className="mono" style={{
          fontSize: 26,
          fontWeight: 600,
          color: accent ? "var(--cyan-600)" : "var(--fg)",
        }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>{unit}</span>}
      </div>
    </Card>
  );
}

type DashboardState = {
  health: { version: string; port: number; startedAt: string } | null;
  runs: RunRow[];
  providers: ProviderInfo[];
  pipelines: PipelineEntry[];
  activeEvents: RunEvent[];
};

const EMPTY_STATE: DashboardState = {
  health: null,
  runs: [],
  providers: [],
  pipelines: [],
  activeEvents: [],
};

export function Dashboard() {
  const { pushToast } = useToast();
  const [data, setData] = useState<DashboardState>(EMPTY_STATE);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [health, runs, providers, pipelines] = await Promise.all([
        api.health(),
        api.listRuns(),
        api.listProviders(),
        api.listPipelines(),
      ]);
      const activeRun = runs.find((run) => run.status === "running") ?? null;
      const activeEvents = activeRun ? (await api.getRun(activeRun.id)).events : [];
      setData({ health, runs, providers, pipelines, activeEvents });
      setError(null);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not load dashboard", description: message });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 3000);
    return () => window.clearInterval(id);
  }, [load]);

  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;
  const runsToday = data.runs.filter((run) => new Date(run.startedAt).getTime() >= dayStart.getTime());
  const weekRuns = data.runs.filter((run) => new Date(run.startedAt).getTime() >= weekStart);
  const finishedRuns = data.runs.filter((run) => run.status !== "running");
  const successRate = finishedRuns.length
    ? Math.round((finishedRuns.filter((run) => run.status === "success").length / finishedRuns.length) * 100)
    : 0;
  const activeRun = data.runs.find((run) => run.status === "running") ?? null;
  const activeProjection = activeRun ? projectRun(activeRun, data.activeEvents) : null;
  const dagStages = activeProjection ? toDagStages(activeProjection.stages) : [];
  const configuredProviders = data.providers.filter((provider) => provider.configured);
  const recentRuns = data.runs.slice(0, 6);

  const headerSummary = activeRun
    ? `${data.runs.filter((run) => run.status === "running").length} active run${data.runs.filter((run) => run.status === "running").length === 1 ? "" : "s"}`
    : `${data.pipelines.length} pipeline${data.pipelines.length === 1 ? "" : "s"} registered`;

  return (
    <div style={{ padding: "28px 28px 60px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 4, fontWeight: 500 }}>
            {new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.4, margin: 0 }}>
            Dashboard
          </h1>
          <p style={{ fontSize: 14, color: "var(--fg-muted)", margin: "4px 0 0" }}>
            {loading ? "Loading workspace data..." : headerSummary}
            {activeProjection?.activeStageId && (
              <> &middot; <span style={{ color: "var(--cyan-600)" }}>{activeProjection.activeStageId}</span> is running</>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btnGhost} onClick={load}>
            {Icons.refresh}<span style={{ marginLeft: 6 }}>Refresh</span>
          </button>
          <button type="button" style={btnGhost} onClick={() => { window.location.hash = "#/pipelines"; }}>
            {Icons.plus}<span style={{ marginLeft: 6 }}>New pipeline</span>
          </button>
        </div>
      </div>

      {error && (
        <Card style={{ marginBottom: 16, color: "var(--err)", fontSize: 13 }}>
          {error}
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 20 }}>
        <Stat label="Runs today" value={String(runsToday.length)} />
        <Stat label="Spend · 7 days" value={formatMoney(weekRuns.reduce((sum, run) => sum + run.totalCost, 0))} accent />
        <Stat label="Tokens · 7 days" value={compactNumber(weekRuns.reduce((sum, run) => sum + run.totalTokens, 0))} />
        <Stat label="Success rate" value={String(successRate)} unit="%" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 16, marginBottom: 20 }}>
        <Card pad={0}>
          <div style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            <span className={activeRun ? "ot-pulse" : undefined} style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: activeRun ? "var(--cyan-500)" : "var(--fg-dim)",
            }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {activeRun ? activeRun.pipelineName : "No active run"}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 1 }}>
                {activeRun
                  ? `Started ${formatRelative(activeRun.startedAt)} · ${activeRun.input}`
                  : "Start a registered pipeline to see its live stages here."}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            {activeRun && (
              <>
                <button type="button" style={{ ...btnGhost, color: "var(--err)" }} onClick={() => cancelRun(activeRun.id, load, pushToast)}>
                  {Icons.stop}<span style={{ marginLeft: 6 }}>Stop</span>
                </button>
                <button type="button" style={btnGhost} onClick={() => { window.location.hash = `#/runs/${activeRun.id}`; }}>
                  {Icons.eye}<span style={{ marginLeft: 6 }}>Open</span>
                </button>
              </>
            )}
          </div>
          <div style={{ padding: "18px 12px", minHeight: 256 }}>
            {activeRun && dagStages.length > 0 ? (
              <Dag stages={dagStages} width={640} height={220} active={activeProjection?.activeStageId ?? undefined} compact={dagStages.length > 6} />
            ) : (
              <div style={{ padding: "70px 20px", textAlign: "center", color: "var(--fg-muted)", fontSize: 13 }}>
                {activeRun ? "Waiting for stage events..." : "No running pipeline."}
              </div>
            )}
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card>
            <div style={{ fontSize: 12, color: "var(--fg-muted)", fontWeight: 500, marginBottom: 10 }}>
              {activeRun ? "Active run totals" : "Runtime"}
            </div>
            {activeRun ? (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{formatMoney(activeRun.totalCost)}</span>
                  <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>{activeRun.totalTokens.toLocaleString()} tokens</span>
                </div>
                <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--fg-muted)", display: "flex", justifyContent: "space-between" }}>
                  <span>{runDuration(activeRun)}</span>
                  <span className="mono">{data.activeEvents.length} events</span>
                </div>
              </>
            ) : (
              <div className="mono" style={{ fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.8 }}>
                <div>v{data.health?.version ?? "unknown"}</div>
                <div>port {data.health?.port ?? "unknown"}</div>
                <div>{configuredProviders.length} configured providers</div>
              </div>
            )}
          </Card>

          <Card>
            <div style={{ fontSize: 12, color: "var(--fg-muted)", fontWeight: 500, marginBottom: 10 }}>
              Providers
            </div>
            {data.providers.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--fg-muted)" }}>No providers returned by the API.</div>
            ) : (
              data.providers
                .slice()
                .sort((a, b) => Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name))
                .slice(0, 6)
                .map((provider) => (
                  <div key={provider.id} style={{
                    display: "flex", alignItems: "center", padding: "6px 0",
                    fontSize: 13, gap: 10, borderTop: "1px solid var(--border)",
                  }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: 3,
                      background: provider.configured ? "var(--ok)" : "var(--fg-dim)",
                    }} />
                    <span style={{ flex: 1 }}>{provider.name}</span>
                    <span className="mono" style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>{provider.configured ? "configured" : provider.category}</span>
                  </div>
                ))
            )}
          </Card>
        </div>
      </div>

      <Card pad={0}>
        <div style={{
          padding: "12px 18px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Recent runs</div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>{data.runs.length} stored</span>
        </div>
        {recentRuns.length === 0 ? (
          <div style={{ padding: 24, color: "var(--fg-muted)", fontSize: 13 }}>No runs recorded yet.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{
                color: "var(--fg-muted)", fontSize: 11.5, fontWeight: 500,
                textAlign: "left", textTransform: "uppercase", letterSpacing: 0.4,
              }}>
                {["Run", "Pipeline", "Input", "Duration", "Cost", "Status"].map((h) => (
                  <th key={h} style={{ padding: "8px 18px", borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => (
                <tr
                  key={run.id}
                  style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                  onClick={() => { window.location.hash = `#/runs/${run.id}`; }}
                >
                  <td className="mono" style={{ padding: "10px 18px" }}>{run.id.slice(0, 8)}</td>
                  <td style={{ padding: "10px 18px", fontWeight: 500 }}>{run.pipelineName}</td>
                  <td style={{
                    padding: "10px 18px", color: "var(--fg-muted)",
                    maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{run.input}</td>
                  <td className="mono" style={{ padding: "10px 18px" }}>{runDuration(run)}</td>
                  <td className="mono" style={{ padding: "10px 18px" }}>{formatMoney(run.totalCost)}</td>
                  <td style={{ padding: "10px 18px" }}>
                    <StatusPill status={run.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function toDagStages(stages: ReturnType<typeof projectRun>["stages"]): DagStage[] {
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

function StatusPill({ status }: { status: RunRow["status"] }) {
  const color =
    status === "success" ? "var(--ok)" :
      status === "failed" ? "var(--err)" :
        status === "cancelled" ? "var(--warn)" : "var(--cyan-500)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "2px 8px", borderRadius: 12, fontSize: 11.5, fontWeight: 500,
      background: "var(--bg-soft)",
      color,
    }}>
      <span className={status === "running" ? "ot-pulse" : undefined} style={{ width: 5, height: 5, borderRadius: 3, background: "currentColor" }} />
      {status}
    </span>
  );
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

async function cancelRun(
  runId: string,
  reload: () => Promise<void>,
  pushToast: ReturnType<typeof useToast>["pushToast"],
) {
  try {
    await api.cancelRun(runId);
    pushToast({ kind: "info", title: "Cancellation requested" });
    await reload();
  } catch (e) {
    pushToast({ kind: "error", title: "Could not cancel run", description: (e as Error).message });
  }
}
