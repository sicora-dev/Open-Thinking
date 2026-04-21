import { useCallback, useEffect, useState } from "react";
import { Icons } from "../components/Icons";
import { useToast } from "../components/ToastProvider";
import { api, type RunRow } from "../lib/api";
import { formatMoney, formatRelative, runDuration } from "../lib/run-events";

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

const stColor: Record<RunRow["status"], string> = {
  running: "var(--cyan-500)",
  success: "var(--ok)",
  failed: "var(--err)",
  cancelled: "var(--warn)",
};

export function History() {
  const { pushToast } = useToast();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setRuns(await api.listRuns());
      setError(null);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not load runs", description: message });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 3000);
    return () => window.clearInterval(id);
  }, [load]);

  const filtered = runs.filter((run) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [
      run.id,
      run.pipelineName,
      run.pipelinePath ?? "",
      run.input,
      run.status,
    ].some((value) => value.toLowerCase().includes(q));
  });
  const sparkData = dailyCounts(runs, 30);
  const totalCost = runs.reduce((sum, run) => sum + run.totalCost, 0);
  const totalTokens = runs.reduce((sum, run) => sum + run.totalTokens, 0);
  const dailyAverage = sparkData.reduce((sum, count) => sum + count, 0) / sparkData.length;

  return (
    <div style={{ padding: "24px 28px 60px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, margin: 0 }}>History</h1>
          <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: "4px 0 0" }}>
            {loading ? "Loading runs..." : `${runs.length} runs`}
            {!loading && (
              <> &middot; <span className="mono">{formatMoney(totalCost)} total &middot; {totalTokens.toLocaleString()} tokens</span></>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{
            width: 260,
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-sm)",
            display: "flex",
            alignItems: "center",
            padding: "5px 9px",
          }}>
            <span style={{ color: "var(--fg-dim)", marginRight: 7 }}>{Icons.search}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search runs"
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                color: "var(--fg)",
                fontSize: 12.5,
                fontFamily: "inherit",
              }}
            />
          </div>
          <button type="button" style={btnGhost} onClick={() => exportCsv(filtered)}>Export CSV</button>
        </div>
      </div>

      {error && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--err)", borderRadius: "var(--r-lg)", padding: 12, marginBottom: 16, color: "var(--err)", fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "var(--fg-muted)", fontWeight: 500 }}>Runs &middot; last 30 days</div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>daily average: {dailyAverage.toFixed(1)}</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 60 }}>
          {sparkData.map((count, index) => {
            const max = Math.max(...sparkData, 1);
            return (
              <div key={index} style={{
                flex: 1,
                height: `${Math.max(2, (count / max) * 100)}%`,
                background: count > 0 ? (index > 26 ? "var(--cyan-500)" : "var(--cyan-200)") : "var(--border)",
                borderRadius: 2,
              }} />
            );
          })}
        </div>
      </div>

      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 24, fontSize: 13, color: "var(--fg-muted)" }}>
            {runs.length === 0 ? "No runs recorded yet." : "No runs match the current search."}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--fg-muted)", fontSize: 11, fontWeight: 500, textAlign: "left", textTransform: "uppercase", letterSpacing: 0.5 }}>
                {["Run", "Pipeline", "Input", "Duration", "Tokens", "Cost", "When", "Status"].map((h) => (
                  <th key={h} style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((run) => (
                <tr
                  key={run.id}
                  style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-soft)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  onClick={() => { window.location.hash = `#/runs/${run.id}`; }}
                >
                  <td className="mono" style={{ padding: "9px 16px" }}>{run.id.slice(0, 8)}</td>
                  <td style={{ padding: "9px 16px", fontWeight: 500 }}>{run.pipelineName}</td>
                  <td style={{ padding: "9px 16px", color: "var(--fg-muted)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.input}</td>
                  <td className="mono" style={{ padding: "9px 16px" }}>{runDuration(run)}</td>
                  <td className="mono" style={{ padding: "9px 16px" }}>{run.totalTokens.toLocaleString()}</td>
                  <td className="mono" style={{ padding: "9px 16px" }}>{formatMoney(run.totalCost)}</td>
                  <td style={{ padding: "9px 16px", color: "var(--fg-muted)" }} title={new Date(run.startedAt).toLocaleString()}>{formatRelative(run.startedAt)}</td>
                  <td style={{ padding: "9px 16px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: stColor[run.status] }}>
                      <span className={run.status === "running" ? "ot-pulse" : undefined} style={{ width: 5, height: 5, borderRadius: 3, background: "currentColor" }} />
                      {run.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function dailyCounts(runs: RunRow[], days: number): number[] {
  const counts = Array.from({ length: days }, () => 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const run of runs) {
    const date = new Date(run.startedAt);
    date.setHours(0, 0, 0, 0);
    const offset = Math.floor((today.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
    if (offset >= 0 && offset < days) counts[days - offset - 1] += 1;
  }

  return counts;
}

function exportCsv(runs: RunRow[]) {
  const rows = [
    ["id", "pipeline", "status", "started_at", "ended_at", "tokens", "cost", "input"],
    ...runs.map((run) => [
      run.id,
      run.pipelineName,
      run.status,
      run.startedAt,
      run.endedAt ?? "",
      String(run.totalTokens),
      String(run.totalCost),
      run.input,
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "openthk-runs.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
