import { useEffect, useRef, useState } from "react";
import { Dag, type DagStage } from "../components/Dag";
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

const stages: DagStage[] = [
  { id: "planning", label: "Planning", provider: "anthropic", model: "claude-opus-4-5", status: "done", layer: 0, duration: "12.4s" },
  { id: "develop", label: "Develop", provider: "openai", model: "gpt-4o", status: "running", layer: 1, duration: "23s", depends_on: ["planning"] },
  { id: "lint", label: "Lint", provider: "openai", model: "gpt-4o-mini", status: "done", layer: 1, duration: "4.1s", depends_on: ["planning"] },
  { id: "testing", label: "Testing", provider: "anthropic", model: "claude-sonnet-4", status: "pending", layer: 2, depends_on: ["develop", "lint"] },
];

type LogLine = { t: string; lvl: string; s: string; m: string };

const logLines: LogLine[] = [
  { t: "14:22:04", lvl: "info", s: "planning", m: "Stage started \u00b7 claude-opus-4-5 \u00b7 temp 0.7" },
  { t: "14:22:06", lvl: "tool", s: "planning", m: 'list_files(".")' },
  { t: "14:22:07", lvl: "tool", s: "planning", m: 'read_file("package.json") \u2192 1.8KB' },
  { t: "14:22:13", lvl: "ctx", s: "planning", m: "write plan.architecture (2,418 chars)" },
  { t: "14:22:16", lvl: "ok", s: "planning", m: "Stage complete \u00b7 4 iterations \u00b7 8,420 tokens \u00b7 $0.84" },
  { t: "14:22:16", lvl: "info", s: "develop", m: "Stage started \u00b7 gpt-4o \u00b7 temp 0.3" },
  { t: "14:22:16", lvl: "info", s: "lint", m: "Stage started \u00b7 gpt-4o-mini \u00b7 temp 0.3 (parallel)" },
  { t: "14:22:21", lvl: "tool", s: "develop", m: 'read_file("src/index.ts") \u2192 0.4KB' },
  { t: "14:22:24", lvl: "tool", s: "develop", m: 'write_file("src/api/routes.ts", 3.2KB)' },
  { t: "14:22:27", lvl: "ok", s: "lint", m: "Stage complete \u00b7 2 iterations \u00b7 1,208 tokens \u00b7 $0.03" },
  { t: "14:22:32", lvl: "tool", s: "develop", m: 'run_command("bun test") \u00b7 1.8s' },
  { t: "14:22:39", lvl: "warn", s: "develop", m: "Rate limit 429 \u00b7 retrying with backoff (1.2s)" },
];

const lvlColor: Record<string, string> = {
  info: "var(--fg-muted)",
  tool: "var(--cyan-600)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  err: "var(--err)",
  ctx: "#8b5cf6",
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
  const [prompt, setPrompt] = useState("Build a REST API for a todo app with CRUD endpoints, JWT auth and Postgres.");
  const [running, setRunning] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const showLeft = width >= 900;
  const showRight = width >= 1120;
  const cols = [showLeft ? "300px" : null, "1fr", showRight ? "320px" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={wrapRef} style={{ display: "grid", gridTemplateColumns: cols, height: "100%", minHeight: 0 }}>
      {/* Left: run configuration */}
      {showLeft && (
        <div style={{ borderRight: "1px solid var(--border)", padding: "20px 18px", overflowY: "auto" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fg-dim)", fontWeight: 600, marginBottom: 10 }}>Pipeline</div>
          <button type="button" style={{
            width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
            background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: "var(--r-md)", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
          }}>
            <span style={{ color: "var(--cyan-500)" }}>{Icons.flow}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>feature-development</div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>3 stages &middot; sequential &middot; v1.0</div>
            </div>
            <span style={{ color: "var(--fg-dim)" }}>{Icons.chevDown}</span>
          </button>

          <div style={{ marginTop: 20, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fg-dim)", fontWeight: 600, marginBottom: 10 }}>Input</div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            style={{
              width: "100%", minHeight: 140, padding: "10px 12px",
              background: "var(--bg-card)", border: "1px solid var(--border)",
              borderRadius: "var(--r-md)", fontSize: 13, color: "var(--fg)",
              fontFamily: "inherit", resize: "vertical", outline: "none", lineHeight: 1.5,
            }}
          />

          <div style={{ marginTop: 20, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fg-dim)", fontWeight: 600, marginBottom: 10 }}>Options</div>
          {[
            { label: "Dry run", hint: "Show plan only", on: false },
            { label: "Run stage", hint: "All stages", on: false },
            { label: "Skills dir", hint: "./skills", on: false, mono: true },
            { label: "Audit log", hint: "Enabled", on: true },
          ].map((o) => (
            <div key={o.label} style={{ display: "flex", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
              <div style={{ flex: 1 }}>
                <div>{o.label}</div>
                <div className={o.mono ? "mono" : undefined} style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>{o.hint}</div>
              </div>
              <div style={{
                width: 28, height: 16, borderRadius: 8,
                background: o.on ? "var(--cyan-500)" : "var(--border-strong)",
                position: "relative", cursor: "pointer",
              }}>
                <div style={{
                  position: "absolute", top: 2, left: o.on ? 14 : 2,
                  width: 12, height: 12, borderRadius: 6, background: "#fff",
                }} />
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setRunning(!running)}
            style={{
              marginTop: 22, width: "100%",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "10px 16px",
              background: running ? "var(--bg-card)" : "var(--cyan-500)",
              border: running ? "1px solid var(--border)" : "none",
              borderRadius: "var(--r-md)", cursor: "pointer",
              fontSize: 13, color: running ? "var(--err)" : "#fff", fontWeight: 500,
              fontFamily: "inherit",
            }}
          >
            {running ? <>{Icons.stop} Stop run</> : <>{Icons.play} Run pipeline</>}
          </button>
        </div>
      )}

      {/* Middle: graph + logs */}
      <div style={{ overflowY: "auto", padding: "20px 24px" }}>
        {/* DAG card */}
        <div style={{
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: "var(--r-lg)", padding: 16, marginBottom: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                <span className="ot-pulse" style={{ width: 8, height: 8, borderRadius: 4, background: "var(--cyan-500)" }} />
                Running &middot; <span className="mono" style={{ fontWeight: 400, color: "var(--fg-muted)" }}>r_4820</span>
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 2 }}>
                2m 18s elapsed &middot; 2 of 4 stages complete &middot; $2.14
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" style={btnGhost}>{Icons.eye}<span style={{ marginLeft: 6 }}>Plan</span></button>
              <button type="button" style={btnGhost}>{Icons.copy}<span style={{ marginLeft: 6 }}>Share</span></button>
            </div>
          </div>
          <Dag stages={stages} width={720} height={200} active="develop" />
        </div>

        {/* Logs */}
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
              Live logs
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {["all", "planning", "develop", "lint", "testing"].map((t, i) => (
                <button key={t} type="button" style={{
                  padding: "3px 10px", fontSize: 11.5,
                  background: i === 2 ? "var(--bg-soft)" : "transparent",
                  border: "1px solid",
                  borderColor: i === 2 ? "var(--border-strong)" : "transparent",
                  borderRadius: "var(--r-sm)", cursor: "pointer",
                  color: i === 2 ? "var(--fg)" : "var(--fg-muted)",
                  fontFamily: "inherit",
                }}>{t}</button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>tail &middot; follow</span>
          </div>
          <div style={{
            padding: "10px 0", maxHeight: 420, overflowY: "auto",
            fontFamily: "var(--font-mono)", fontSize: 12,
          }}>
            {logLines.map((l, i) => (
              <div key={i} style={{ padding: "2px 14px", display: "flex", gap: 12, alignItems: "baseline" }}>
                <span style={{ color: "var(--fg-dim)" }}>{l.t}</span>
                <span style={{
                  color: lvlColor[l.lvl] ?? "var(--fg-muted)",
                  width: 38, flexShrink: 0, textTransform: "uppercase",
                  fontSize: 10.5, fontWeight: 600,
                }}>{l.lvl}</span>
                <span style={{ color: "var(--fg-muted)", width: 70, flexShrink: 0 }}>{l.s}</span>
                <span style={{ color: "var(--fg)", flex: 1 }}>{l.m}</span>
              </div>
            ))}
            <div style={{ padding: "2px 14px", display: "flex", gap: 12, alignItems: "baseline" }}>
              <span style={{ color: "var(--fg-dim)" }}>14:22:42</span>
              <span style={{ color: "var(--cyan-600)", width: 38, textTransform: "uppercase", fontSize: 10.5, fontWeight: 600 }}>tool</span>
              <span style={{ color: "var(--fg-muted)", width: 70 }}>develop</span>
              <span style={{ color: "var(--fg)" }}>
                write_file(&quot;src/api/handlers.ts&quot;<span className="ot-cursor">{"\u258C"}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: inspector */}
      {showRight && (
        <div style={{ borderLeft: "1px solid var(--border)", overflowY: "auto" }}>
          <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fg-dim)", fontWeight: 600, marginBottom: 6 }}>Selected stage</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="ot-pulse" style={{ width: 8, height: 8, borderRadius: 4, background: "var(--cyan-500)" }} />
              <div style={{ fontSize: 15, fontWeight: 600 }}>develop</div>
            </div>
            <div className="mono" style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 4 }}>openai &middot; gpt-4o</div>
          </div>

          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <Row k="Iteration" v="3 / 50" />
            <Row k="Prompt tok" v="4,812" mono />
            <Row k="Output tok" v="2,104" mono />
            <Row k="Cost" v="$0.78" mono />
            <Row k="Duration" v="23s" mono />
          </div>

          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fg-dim)", fontWeight: 600, marginBottom: 8 }}>Skill</div>
            <div style={{ padding: "8px 10px", background: "var(--bg-soft)", borderRadius: "var(--r-sm)", fontSize: 12 }}>
              <div className="mono" style={{ fontSize: 12 }}>openthk/code-writer@1.0</div>
              <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 4 }}>
                Tools: read_file, write_file, list_files, run_command, search_files
              </div>
            </div>
          </div>

          <div style={{ padding: "14px 18px" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fg-dim)", fontWeight: 600, marginBottom: 8 }}>Context access</div>
            {[
              { t: "read", keys: ["plan.*", "code.decisions"] },
              { t: "write", keys: ["code.*"] },
            ].map((g) => (
              <div key={g.t} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginBottom: 4 }}>{g.t}</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {g.keys.map((k) => (
                    <span key={k} className="mono" style={{
                      padding: "2px 6px", fontSize: 11,
                      background: g.t === "read" ? "rgba(6,182,212,0.08)" : "rgba(139,92,246,0.08)",
                      color: g.t === "read" ? "var(--cyan-700)" : "#7c3aed",
                      borderRadius: 3,
                      border: "1px solid",
                      borderColor: g.t === "read" ? "rgba(6,182,212,0.2)" : "rgba(139,92,246,0.2)",
                    }}>{k}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
