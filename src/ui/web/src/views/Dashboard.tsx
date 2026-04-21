import { Icons } from "../components/Icons";
import { Dag, type DagStage } from "../components/Dag";

const stages: DagStage[] = [
  { id: "planning", label: "Planning", provider: "anthropic", model: "claude-opus-4-5", status: "done", layer: 0, duration: "12.4s" },
  { id: "develop", label: "Develop", provider: "openai", model: "gpt-4o", status: "running", layer: 1, duration: "23s", depends_on: ["planning"] },
  { id: "lint", label: "Lint", provider: "openai", model: "gpt-4o-mini", status: "done", layer: 1, duration: "4.1s", depends_on: ["planning"] },
  { id: "testing", label: "Testing", provider: "anthropic", model: "claude-sonnet-4", status: "pending", layer: 2, duration: "\u2014", depends_on: ["develop", "lint"] },
];

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

function Stat({ label, value, unit, trend, accent }: {
  label: string;
  value: string;
  unit?: string;
  trend?: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 12, color: "var(--fg-muted)", fontWeight: 500 }}>{label}</div>
        {trend && (
          <div style={{
            fontSize: 11,
            color: trend.startsWith("+") ? "var(--ok)" : "var(--fg-muted)",
            fontVariantNumeric: "tabular-nums",
          }}>
            {trend}
          </div>
        )}
      </div>
      <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", gap: 4 }}>
        <span className="mono" style={{
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: -0.5,
          color: accent ? "var(--cyan-600)" : "var(--fg)",
        }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>{unit}</span>}
      </div>
    </Card>
  );
}

const recentRuns = [
  { id: "r_4819", name: "feature-development", input: "Add a rate-limiter middleware", dur: "2m 04s", cost: "$1.92", st: "done" as const },
  { id: "r_4818", name: "docs-refresh", input: "Update quickstart guide", dur: "38s", cost: "$0.21", st: "done" as const },
  { id: "r_4817", name: "feature-development", input: "Build a REST API for todo\u2026", dur: "3m 11s", cost: "$2.48", st: "failed" as const },
  { id: "r_4816", name: "triage-agent", input: "Triage last 25 Sentry issues", dur: "1m 47s", cost: "$0.64", st: "done" as const },
  { id: "r_4815", name: "feature-development", input: "Refactor auth module", dur: "4m 52s", cost: "$3.20", st: "done" as const },
];

const providers = [
  { id: "anthropic", name: "Anthropic", latency: "218ms", ok: true },
  { id: "openai", name: "OpenAI", latency: "174ms", ok: true },
  { id: "google", name: "Google", latency: "\u2014 ", ok: false },
  { id: "ollama", name: "Ollama \u00b7 local", latency: "42ms", ok: true },
];

export function Dashboard() {
  return (
    <div style={{ padding: "28px 28px 60px", maxWidth: 1280, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 4, fontWeight: 500 }}>
            {new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.4, margin: 0 }}>
            Dashboard
          </h1>
          <p style={{ fontSize: 14, color: "var(--fg-muted)", margin: "4px 0 0" }}>
            1 pipeline running &middot; <span style={{ color: "var(--cyan-600)" }}>develop</span> is on stage 2 of 3.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btnGhost}>
            {Icons.refresh}<span style={{ marginLeft: 6 }}>Refresh</span>
          </button>
          <button type="button" style={btnGhost}>
            {Icons.plus}<span style={{ marginLeft: 6 }}>New pipeline</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <Stat label="Runs today" value="14" trend="+3" />
        <Stat label="Spend \u00b7 week" value="$12.84" unit="/ $50" accent />
        <Stat label="Tokens" value="4.2" unit="M" />
        <Stat label="Success rate" value="94" unit="%" trend="+1.2%" />
      </div>

      {/* Active run + right column */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, marginBottom: 20 }}>
        <Card pad={0}>
          <div style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            <span className="ot-pulse" style={{ width: 8, height: 8, borderRadius: 4, background: "var(--cyan-500)" }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                feature-development &middot; <span className="mono" style={{ fontWeight: 400, color: "var(--fg-muted)" }}>#r_4820</span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 1 }}>
                Started 2m 18s ago &middot; &ldquo;Build a REST API for a todo app&hellip;&rdquo;
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <button type="button" style={{ ...btnGhost, color: "var(--err)" }}>
              {Icons.stop}<span style={{ marginLeft: 6 }}>Stop</span>
            </button>
            <button type="button" style={btnGhost}>
              {Icons.eye}<span style={{ marginLeft: 6 }}>Open</span>
            </button>
          </div>
          <div style={{ padding: "18px 12px" }}>
            <Dag stages={stages} width={640} height={220} active="develop" />
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Budget card */}
          <Card>
            <div style={{ fontSize: 12, color: "var(--fg-muted)", fontWeight: 500, marginBottom: 10 }}>
              Budget &middot; this run
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>$2.14</span>
              <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>/ $50.00 cap</span>
            </div>
            <div style={{
              marginTop: 10, height: 6, background: "var(--bg-soft)",
              borderRadius: 3, overflow: "hidden", position: "relative",
            }}>
              <div style={{ width: "4.3%", height: "100%", background: "var(--cyan-500)" }} />
            </div>
            <div style={{
              marginTop: 10, fontSize: 11.5, color: "var(--fg-muted)",
              display: "flex", justifyContent: "space-between",
            }}>
              <span>Rate &middot; 42 / 100 &middot; hr</span>
              <span className="mono">892K tok</span>
            </div>
          </Card>

          {/* Providers online */}
          <Card>
            <div style={{ fontSize: 12, color: "var(--fg-muted)", fontWeight: 500, marginBottom: 10 }}>
              Providers online
            </div>
            {providers.map((p) => (
              <div key={p.id} style={{
                display: "flex", alignItems: "center", padding: "6px 0",
                fontSize: 13, gap: 10, borderTop: "1px solid var(--border)",
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: 3,
                  background: p.ok ? "var(--ok)" : "var(--fg-dim)",
                }} />
                <span style={{ flex: 1 }}>{p.name}</span>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>{p.latency}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>

      {/* Recent runs table */}
      <Card pad={0}>
        <div style={{
          padding: "12px 18px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Recent runs</div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>Last 7 days</span>
        </div>
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
            {recentRuns.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="mono" style={{ padding: "10px 18px" }}>{r.id}</td>
                <td style={{ padding: "10px 18px", fontWeight: 500 }}>{r.name}</td>
                <td style={{
                  padding: "10px 18px", color: "var(--fg-muted)",
                  maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{r.input}</td>
                <td className="mono" style={{ padding: "10px 18px" }}>{r.dur}</td>
                <td className="mono" style={{ padding: "10px 18px" }}>{r.cost}</td>
                <td style={{ padding: "10px 18px" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "2px 8px", borderRadius: 12, fontSize: 11.5, fontWeight: 500,
                    background: r.st === "done" ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
                    color: r.st === "done" ? "var(--ok)" : "var(--err)",
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: 3, background: "currentColor" }} />
                    {r.st}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
