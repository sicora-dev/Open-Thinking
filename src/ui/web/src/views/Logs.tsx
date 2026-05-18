import { useCallback, useEffect, useMemo, useState } from "react";
import { Icons } from "../components/Icons";
import { useToast } from "../components/ToastProvider";
import { api } from "../lib/api";
import { formatTime, projectRun, type ProjectedLogLine } from "../lib/run-events";

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

export function Logs() {
  const { pushToast } = useToast();
  const [logs, setLogs] = useState<ProjectedLogLine[]>([]);
  const [level, setLevel] = useState("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const runs = await api.listRuns();
      const details = await Promise.all(runs.slice(0, 20).map((run) => api.getRun(run.id)));
      const next = details
        .flatMap((detail) => projectRun(detail.run, detail.events).eventLogs)
        .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      setLogs(next);
      setError(null);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not load run events", description: message });
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 3000);
    return () => window.clearInterval(id);
  }, [load]);

  const levels = useMemo(() => ["all", ...Array.from(new Set(logs.map((line) => line.level))).sort()], [logs]);
  const filtered = logs.filter((line) => {
    if (level !== "all" && line.level !== level) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [line.pipelineName, line.runId, line.source, line.type, line.message]
      .some((value) => value.toLowerCase().includes(q));
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        padding: "12px 20px", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ color: "var(--fg-dim)" }}>{Icons.terminal}</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Run events</span>
        <div style={{ display: "flex", gap: 4, marginLeft: 16 }}>
          {levels.map((item) => (
            <button key={item} type="button" onClick={() => setLevel(item)} style={{
              padding: "3px 10px", fontSize: 11.5,
              background: level === item ? "var(--bg-soft)" : "transparent",
              border: "1px solid",
              borderColor: level === item ? "var(--border-strong)" : "transparent",
              borderRadius: "var(--r-sm)", cursor: "pointer",
              color: level === item ? "var(--fg)" : "var(--fg-muted)",
              fontFamily: "inherit",
            }}>{item}</button>
          ))}
        </div>
        <div style={{
          minWidth: 220,
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-sm)",
          display: "flex",
          alignItems: "center",
          padding: "4px 8px",
        }}>
          <span style={{ color: "var(--fg-dim)", marginRight: 6 }}>{Icons.search}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search events"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--fg)", fontSize: 12, fontFamily: "inherit" }}
          />
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: "var(--fg-muted)", display: "flex", alignItems: "center", gap: 5 }}>
          <span className="ot-pulse" style={{ width: 5, height: 5, borderRadius: 3, background: "currentColor" }} /> polling
        </span>
        <button type="button" style={btnGhost} onClick={load}>{Icons.refresh}<span style={{ marginLeft: 6 }}>Refresh</span></button>
        <button type="button" style={btnGhost} onClick={() => copyLogs(filtered)}>{Icons.copy}<span style={{ marginLeft: 6 }}>Copy</span></button>
      </div>

      <div style={{
        flex: 1, overflowY: "auto", padding: "12px 0",
        fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg-soft)",
      }}>
        {error && <div style={{ padding: "10px 20px", color: "var(--err)" }}>{error}</div>}
        {loading && <div style={{ padding: "10px 20px", color: "var(--fg-muted)" }}>Loading events...</div>}
        {!loading && filtered.length === 0 && !error && (
          <div style={{ padding: "10px 20px", color: "var(--fg-muted)" }}>
            {logs.length === 0 ? "No persisted run events yet." : "No events match the current filter."}
          </div>
        )}
        {filtered.map((line, index) => (
          <div
            key={`${line.runId}-${line.ts}-${index}`}
            onClick={() => { window.location.hash = `#/runs/${line.runId}?from=logs`; }}
            style={{
              padding: "2px 20px",
              display: "flex",
              gap: 14,
              alignItems: "baseline",
              cursor: "pointer",
            }}
          >
            <span style={{ color: "var(--fg-dim)" }}>{formatTime(line.ts)}</span>
            <span style={{
              color: lvlColor[line.level] ?? "var(--fg-muted)",
              width: 42, flexShrink: 0, textTransform: "uppercase",
              fontSize: 10.5, fontWeight: 600,
            }}>{line.level}</span>
            <span style={{ color: "var(--fg-muted)", width: 86, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{line.source}</span>
            <span className="mono" style={{ color: "var(--fg-dim)", width: 72, flexShrink: 0 }}>{line.runId.slice(0, 8)}</span>
            <span style={{ color: "var(--fg)", flex: 1 }}>{line.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function copyLogs(lines: ProjectedLogLine[]) {
  const text = lines
    .map((line) => `[${line.ts}] ${line.level} ${line.source} ${line.runId} ${line.message}`)
    .join("\n");
  navigator.clipboard.writeText(text);
}
