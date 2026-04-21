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

type TreeNode = {
  depth: number;
  name: string;
  dir?: boolean;
  open?: boolean;
  size?: string;
};

const tree: TreeNode[] = [
  { depth: 0, name: ".openthk/", dir: true, open: true },
  { depth: 1, name: "pipelines/", dir: true, open: true },
  { depth: 2, name: "default.yaml", size: "1.2 KB" },
  { depth: 2, name: "triage.yaml", size: "0.8 KB" },
  { depth: 1, name: "project.md", size: "2.4 KB" },
  { depth: 1, name: "context.db", size: "184 KB" },
  { depth: 1, name: "history/", dir: true },
  { depth: 1, name: "learned/", dir: true },
  { depth: 0, name: "skills/", dir: true, open: true },
  { depth: 1, name: "openthk/", dir: true },
  { depth: 1, name: "local/", dir: true },
  { depth: 0, name: "openthk.pipeline.yaml", size: "1.2 KB" },
  { depth: 0, name: "src/", dir: true },
  { depth: 0, name: "package.json", size: "1.5 KB" },
  { depth: 0, name: "README.md", size: "5.8 KB" },
];

const previewText = `# Preview of openthk.pipeline.yaml

name: feature-development
version: "1.0"

providers:
  - anthropic
  - openai

stages:
  planning:
    provider: anthropic
    model: claude-opus-4-5-20250520
    skill: openthk/arch-planner@1.0
    ...`;

export function Files() {
  const [sel, setSel] = useState("openthk.pipeline.yaml");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", height: "100%" }}>
      {/* Tree */}
      <div style={{ borderRight: "1px solid var(--border)", overflowY: "auto", padding: "12px 8px" }}>
        <div style={{ padding: "4px 8px 8px", display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600, flex: 1 }}>
            Workspace
          </span>
          <button type="button" style={{ ...btnGhost, padding: "2px 6px" }}>{Icons.plus}</button>
        </div>
        {tree.map((n, i) => (
          <button
            key={i}
            type="button"
            onClick={() => { if (!n.dir) setSel(n.name); }}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              width: "100%", padding: "3px 6px",
              background: sel === n.name ? "var(--bg-card)" : "transparent",
              borderRadius: "var(--r-sm)", fontSize: 12.5, color: "var(--fg)",
              border: "none", cursor: "pointer", textAlign: "left",
              paddingLeft: 8 + n.depth * 14, marginBottom: 1,
              fontFamily: "inherit",
            }}
          >
            <span style={{ color: n.dir ? "var(--cyan-600)" : "var(--fg-dim)" }}>
              {n.dir ? Icons.folder : Icons.file}
            </span>
            <span style={{ flex: 1 }} className={/\.(yaml|md|json|ts)$/.test(n.name) ? "mono" : undefined}>
              {n.name}
            </span>
            {n.size && <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-dim)" }}>{n.size}</span>}
          </button>
        ))}
      </div>

      {/* Preview */}
      <div style={{ overflowY: "auto" }}>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "var(--fg-dim)" }}>{Icons.file}</span>
          <span className="mono" style={{ fontSize: 13 }}>{sel}</span>
          <div style={{ flex: 1 }} />
          <button type="button" style={btnGhost}>{Icons.edit}<span style={{ marginLeft: 6 }}>Edit</span></button>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <pre style={{
            maxWidth: 760, fontFamily: "var(--font-mono)", fontSize: 12.5,
            lineHeight: 1.55, color: "var(--fg)", margin: 0, whiteSpace: "pre-wrap",
          }}>
            {previewText}
          </pre>
        </div>
      </div>
    </div>
  );
}
