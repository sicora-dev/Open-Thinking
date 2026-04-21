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

type RunEntry = {
  id: string;
  p: string;
  input: string;
  at: string;
  dur: string;
  cost: string;
  st: "running" | "done" | "failed";
  t: string;
};

const runs: RunEntry[] = [
  { id: "r_4820", p: "feature-development", input: "Build a REST API for a todo app", at: "2m ago", dur: "running", cost: "$2.14", st: "running", t: "Opus + GPT-4o + Sonnet" },
  { id: "r_4819", p: "feature-development", input: "Add a rate-limiter middleware", at: "1h ago", dur: "2m 04s", cost: "$1.92", st: "done", t: "Opus + GPT-4o + Sonnet" },
  { id: "r_4818", p: "docs-refresh", input: "Update quickstart guide", at: "3h ago", dur: "38s", cost: "$0.21", st: "done", t: "Sonnet" },
  { id: "r_4817", p: "feature-development", input: "Build a REST API for todo app", at: "5h ago", dur: "3m 11s", cost: "$2.48", st: "failed", t: "Opus + GPT-4o" },
  { id: "r_4816", p: "triage-agent", input: "Triage last 25 Sentry issues", at: "Yesterday", dur: "1m 47s", cost: "$0.64", st: "done", t: "Orchestrated \u00b7 4 agents" },
  { id: "r_4815", p: "feature-development", input: "Refactor auth module", at: "Yesterday", dur: "4m 52s", cost: "$3.20", st: "done", t: "Opus + GPT-4o + Sonnet" },
  { id: "r_4814", p: "docs-refresh", input: "Regenerate provider table", at: "2 days ago", dur: "52s", cost: "$0.18", st: "done", t: "Sonnet" },
  { id: "r_4813", p: "feature-development", input: "Add OAuth login flow", at: "3 days ago", dur: "5m 22s", cost: "$3.90", st: "done", t: "Opus + GPT-4o + Sonnet" },
];

const stColor: Record<string, string> = {
  running: "var(--cyan-500)",
  done: "var(--ok)",
  failed: "var(--err)",
};

const sparkData = [3, 1, 4, 6, 2, 0, 5, 3, 7, 4, 2, 5, 6, 3, 4, 8, 5, 2, 3, 5, 4, 6, 9, 4, 3, 5, 4, 7, 4, 6];

export function History() {
  return (
    <div style={{ padding: "24px 28px 60px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, margin: 0 }}>History</h1>
          <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: "4px 0 0" }}>
            127 runs &middot; <span className="mono">$47.22 total &middot; 18.4M tokens</span>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btnGhost}>{Icons.search}<span style={{ marginLeft: 6 }}>Search</span></button>
          <button type="button" style={btnGhost}>Export CSV</button>
        </div>
      </div>

      {/* Sparkline bar chart */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "var(--fg-muted)", fontWeight: 500 }}>Runs &middot; last 30 days</div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>daily average: 4.1</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 60 }}>
          {sparkData.map((h, i) => (
            <div key={i} style={{
              flex: 1,
              height: `${h * 10}%`,
              minHeight: 2,
              background: i > 26 ? "var(--cyan-500)" : "var(--cyan-200)",
              borderRadius: 2,
            }} />
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "var(--fg-muted)", fontSize: 11, fontWeight: 500, textAlign: "left", textTransform: "uppercase", letterSpacing: 0.5 }}>
              {["Run", "Pipeline", "Input", "Models", "Duration", "Cost", "When", "Status"].map((h) => (
                <th key={h} style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.id}
                style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-soft)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <td className="mono" style={{ padding: "9px 16px" }}>{r.id}</td>
                <td style={{ padding: "9px 16px", fontWeight: 500 }}>{r.p}</td>
                <td style={{ padding: "9px 16px", color: "var(--fg-muted)", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.input}</td>
                <td style={{ padding: "9px 16px", fontSize: 11.5, color: "var(--fg-muted)" }}>{r.t}</td>
                <td className="mono" style={{ padding: "9px 16px" }}>{r.dur}</td>
                <td className="mono" style={{ padding: "9px 16px" }}>{r.cost}</td>
                <td style={{ padding: "9px 16px", color: "var(--fg-muted)" }}>{r.at}</td>
                <td style={{ padding: "9px 16px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: stColor[r.st] }}>
                    <span className={r.st === "running" ? "ot-pulse" : undefined} style={{ width: 5, height: 5, borderRadius: 3, background: "currentColor" }} />
                    {r.st}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
