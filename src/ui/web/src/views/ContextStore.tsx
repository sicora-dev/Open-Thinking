import { useState } from "react";
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

const entries = [
  { k: "input.prompt", by: "user", v: "Build a REST API for a todo app with CRUD endpoints, JWT auth and Postgres.", size: "218 B", age: "2m" },
  { k: "plan.architecture", by: "planning", v: "## Architecture\n\nWe will use a layered structure with handlers, services, and repositories. Postgres via pg\u2026", size: "2.4 KB", age: "2m" },
  { k: "plan.decisions", by: "planning", v: "Decision: Use Drizzle ORM over raw pg for type safety. JWT refresh tokens stored in Redis.", size: "612 B", age: "2m" },
  { k: "plan.database_schema", by: "planning", v: "Tables: users, todos, sessions. See migrations folder.", size: "1.1 KB", age: "2m" },
  { k: "code.files", by: "develop", v: "src/api/routes.ts, src/api/handlers.ts, src/db/schema.ts, src/middleware/auth.ts", size: "152 B", age: "32s" },
  { k: "code.summary", by: "develop", v: "Implemented CRUD for /todos with Drizzle, JWT auth middleware, 11 endpoints total.", size: "480 B", age: "18s" },
];

export function ContextStore() {
  const [filter, setFilter] = useState("");

  return (
    <div style={{ padding: "24px 28px 60px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, margin: 0 }}>Context store</h1>
          <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: "4px 0 0" }}>
            SQLite &middot; <span className="mono">.openthk/context.db</span> &middot; 6 keys &middot; 5.4 KB &middot; TTL 7d
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btnGhost}>{Icons.refresh}<span style={{ marginLeft: 6 }}>Refresh</span></button>
          <button type="button" style={{ ...btnGhost, color: "var(--err)" }}>{Icons.trash}<span style={{ marginLeft: 6 }}>Clear all</span></button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{
          flex: 1, background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: "var(--r-md)", display: "flex", alignItems: "center", padding: "6px 10px",
        }}>
          <span style={{ color: "var(--fg-dim)", marginRight: 8 }}>{Icons.search}</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by prefix, e.g. plan.*"
            style={{
              flex: 1, border: "none", outline: "none", background: "transparent",
              fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--fg)",
            }}
          />
        </div>
        {["input.*", "plan.*", "code.*", "test.*"].map((p) => (
          <button key={p} type="button" style={{ ...btnGhost, fontFamily: "var(--font-mono)", fontSize: 12 }}>{p}</button>
        ))}
      </div>

      {/* Entries */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
        {entries.map((e, i) => (
          <div key={e.k} style={{ padding: "12px 16px", borderBottom: i < entries.length - 1 ? "1px solid var(--border)" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 500, color: "var(--cyan-700)" }}>{e.k}</span>
              <span style={{
                fontSize: 10.5, padding: "1px 6px", background: "var(--bg-soft)",
                border: "1px solid var(--border)", borderRadius: 3, color: "var(--fg-muted)",
              }}>by {e.by}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--fg-dim)" }}>{e.size}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>{e.age} ago</span>
              <button type="button" style={{ ...btnGhost, padding: "2px 6px" }}>{Icons.copy}</button>
              <button type="button" style={{ ...btnGhost, padding: "2px 6px" }}>{Icons.eye}</button>
            </div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-muted)",
              background: "var(--bg-soft)", borderRadius: "var(--r-sm)", padding: "8px 10px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.5,
            }}>{e.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
