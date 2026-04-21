import type { ReactNode } from "react";

function Section({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div style={{ padding: "24px 0", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "260px 1fr", gap: 40 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 3 }}>{desc}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function Field({ label, value, mono, hint }: { label: string; value: string; mono?: boolean; hint?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 5, fontWeight: 500 }}>{label}</div>
      <input
        defaultValue={value}
        style={{
          width: "100%", padding: "7px 10px", background: "var(--bg-card)",
          border: "1px solid var(--border)", borderRadius: "var(--r-md)",
          fontSize: 13, color: "var(--fg)",
          fontFamily: mono ? "var(--font-mono)" : "inherit", outline: "none",
        }}
      />
      {hint && <div style={{ fontSize: 11.5, color: "var(--fg-dim)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function Toggle({ label, on }: { label: string; on: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ flex: 1, fontSize: 13 }}>{label}</div>
      <div style={{
        width: 28, height: 16, borderRadius: 8,
        background: on ? "var(--cyan-500)" : "var(--border-strong)",
        position: "relative", cursor: "pointer",
      }}>
        <div style={{
          position: "absolute", top: 2, left: on ? 14 : 2,
          width: 12, height: 12, borderRadius: 6, background: "#fff",
        }} />
      </div>
    </div>
  );
}

export function Settings() {
  return (
    <div style={{ padding: "24px 28px 60px", maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, margin: "0 0 4px" }}>Settings</h1>
      <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: 0 }}>Project + global configuration</p>

      <Section title="Project" desc="Stored at .openthk/">
        <Field label="Project name" value="feature-development" />
        <Field label="Default pipeline" value="feature-development" mono />
        <Field label="Context backend" value="sqlite" mono hint="Switch to postgres for shared cross-machine context" />
      </Section>

      <Section title="Limits" desc="Enforced per run. Applied after pipeline policies.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Cost cap" value="$50 / run" mono />
          <Field label="Rate limit" value="100 / hour" mono />
          <Field label="Timeout" value="120s" mono />
          <Field label="Max iters" value="50" mono />
        </div>
      </Section>

      <Section title="Appearance" desc="UI preferences, stored locally.">
        <Toggle label="Reduced motion" on={false} />
        <Toggle label="Compact density" on={false} />
        <Toggle label="Show monospace in tables" on={true} />
        <Toggle label="Auto-open live logs on run" on={true} />
      </Section>

      <Section title="Danger zone" desc="">
        <div style={{ padding: 14, background: "var(--bg-card)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "var(--r-md)" }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Clear context store</div>
          <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2, marginBottom: 12 }}>
            Wipes <span className="mono">.openthk/context.db</span>. Cannot be undone.
          </div>
          <button type="button" style={{
            padding: "6px 12px", background: "transparent",
            border: "1px solid var(--err)", color: "var(--err)",
            borderRadius: "var(--r-sm)", fontSize: 12.5, cursor: "pointer",
            fontFamily: "inherit",
          }}>
            Clear context store
          </button>
        </div>
      </Section>
    </div>
  );
}
