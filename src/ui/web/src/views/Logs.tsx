import { Icons } from "../components/Icons";

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

type LogEntry = { t: string; lvl: string; s: string; m: string };

const logs: LogEntry[] = [
  { t: "14:22:04.118", lvl: "info", s: "executor", m: "Pipeline feature-development started \u00b7 r_4820" },
  { t: "14:22:04.122", lvl: "info", s: "policy", m: "Rate limit OK \u00b7 12/100 hr" },
  { t: "14:22:04.124", lvl: "info", s: "planning", m: "Stage started \u00b7 claude-opus-4-5 \u00b7 temp 0.7" },
  { t: "14:22:04.892", lvl: "http", s: "anthropic", m: "POST /v1/messages \u2192 200 \u00b7 768ms" },
  { t: "14:22:06.012", lvl: "tool", s: "planning", m: 'list_files(".")' },
  { t: "14:22:07.441", lvl: "tool", s: "planning", m: 'read_file("package.json") \u2192 1.8KB' },
  { t: "14:22:13.109", lvl: "ctx", s: "planning", m: "write plan.architecture (2,418 chars)" },
  { t: "14:22:16.002", lvl: "ok", s: "planning", m: "Stage complete \u00b7 4 iters \u00b7 8,420 tok \u00b7 $0.84" },
  { t: "14:22:16.004", lvl: "info", s: "executor", m: "Layer 1: develop, lint (parallel)" },
  { t: "14:22:16.005", lvl: "info", s: "develop", m: "Stage started \u00b7 gpt-4o \u00b7 temp 0.3" },
  { t: "14:22:16.006", lvl: "info", s: "lint", m: "Stage started \u00b7 gpt-4o-mini \u00b7 temp 0.3" },
  { t: "14:22:21.103", lvl: "tool", s: "develop", m: 'read_file("src/index.ts") \u2192 0.4KB' },
  { t: "14:22:24.211", lvl: "tool", s: "develop", m: 'write_file("src/api/routes.ts", 3.2KB)' },
  { t: "14:22:27.881", lvl: "ok", s: "lint", m: "Stage complete \u00b7 2 iters \u00b7 1,208 tok \u00b7 $0.03" },
  { t: "14:22:32.410", lvl: "tool", s: "develop", m: 'run_command("bun test") \u00b7 1.8s' },
  { t: "14:22:39.028", lvl: "warn", s: "openai", m: "Rate limit 429 \u00b7 backoff 1.2s" },
  { t: "14:22:40.228", lvl: "http", s: "openai", m: "POST /v1/chat/completions \u2192 200 \u00b7 2,014ms" },
];

const lvlColor: Record<string, string> = {
  info: "var(--fg-muted)",
  tool: "var(--cyan-600)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  err: "var(--err)",
  ctx: "#8b5cf6",
  http: "#f59e0b",
};

export function Logs() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Toolbar */}
      <div style={{
        padding: "12px 20px", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ color: "var(--fg-dim)" }}>{Icons.terminal}</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Event stream</span>
        <div style={{ display: "flex", gap: 4, marginLeft: 16 }}>
          {["all", "info", "tool", "http", "ctx", "warn", "err"].map((t, i) => (
            <button key={t} type="button" style={{
              padding: "3px 10px", fontSize: 11.5,
              background: i === 0 ? "var(--bg-soft)" : "transparent",
              border: "1px solid",
              borderColor: i === 0 ? "var(--border-strong)" : "transparent",
              borderRadius: "var(--r-sm)", cursor: "pointer",
              color: "var(--fg-muted)", fontFamily: "inherit",
            }}>{t}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: "var(--ok)", display: "flex", alignItems: "center", gap: 5 }}>
          <span className="ot-pulse" style={{ width: 5, height: 5, borderRadius: 3, background: "currentColor" }} /> live
        </span>
        <button type="button" style={btnGhost}>{Icons.copy}<span style={{ marginLeft: 6 }}>Copy</span></button>
      </div>

      {/* Log lines */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "12px 0",
        fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg-soft)",
      }}>
        {logs.map((l, i) => (
          <div key={i} style={{ padding: "2px 20px", display: "flex", gap: 14, alignItems: "baseline" }}>
            <span style={{ color: "var(--fg-dim)" }}>{l.t}</span>
            <span style={{
              color: lvlColor[l.lvl] ?? "var(--fg-muted)",
              width: 38, flexShrink: 0, textTransform: "uppercase",
              fontSize: 10.5, fontWeight: 600,
            }}>{l.lvl}</span>
            <span style={{ color: "var(--fg-muted)", width: 80, flexShrink: 0 }}>{l.s}</span>
            <span style={{ color: "var(--fg)", flex: 1 }}>{l.m}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
