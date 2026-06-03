import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { marked } from "marked";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icons } from "../components/Icons";
import { api, type FsEntry, type PipelineEntry } from "../lib/api";

hljs.registerLanguage("python", python);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("php", php);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("lua", lua);

const EXT_LANG: Record<string, string> = {
  py: "python", js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", jsx: "javascript",
  json: "json", yaml: "yaml", yml: "yaml",
  css: "css", scss: "scss",
  html: "xml", htm: "xml", xml: "xml", svg: "xml",
  sh: "bash", bash: "bash", zsh: "shell",
  rs: "rust", go: "go", java: "java",
  c: "c", cpp: "cpp", cc: "cpp", h: "c", hpp: "cpp",
  cs: "csharp", rb: "ruby", php: "php",
  swift: "swift", kt: "kotlin", kts: "kotlin",
  sql: "sql", lua: "lua",
};

type InterpretMode = "image" | "pdf" | "html" | "markdown";

function getInterpretMode(name: string): InterpretMode | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["html", "htm"].includes(ext)) return "html";
  if (["md", "mdx"].includes(ext)) return "markdown";
  return null;
}

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

export function Files() {
  const [cwd, setCwd] = useState("");
  const [parent, setParent] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [selected, setSelected] = useState<FsEntry | null>(null);
  const [pipelines, setPipelines] = useState<PipelineEntry[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null | "binary" | "tooBig">(null);
  const [interpreted, setInterpreted] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDir = useCallback(async (path?: string, hidden = false) => {
    setLoading(true);
    try {
      const result = await api.browse(path, { showHidden: hidden });
      setCwd(result.path);
      setParent(result.parent);
      setEntries(result.entries);
      setSelected(null);
      setPreview(null);
      setFileContent(null);
      setInterpreted(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listProjects(), api.listPipelines()])
      .then(([projects, pipelineList]) => {
        if (cancelled) return;
        setPipelines(pipelineList);
        const startPath = projects[0]?.path ?? pipelineList[0]?.rootPath;
        loadDir(startPath, showHidden);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
        loadDir(undefined, showHidden);
      });
    return () => {
      cancelled = true;
    };
  }, [loadDir]);

  const selectedPipeline = useMemo(
    () => selected ? pipelines.find((pipeline) => pipeline.path === selected.path) ?? null : null,
    [pipelines, selected],
  );

  const selectEntry = async (entry: FsEntry) => {
    if (entry.isDir) {
      await loadDir(entry.path, showHidden);
      return;
    }

    setSelected(entry);
    setPreview(null);
    setFileContent(null);
    setInterpreted(false);

    const pipeline = pipelines.find((item) => item.path === entry.path);
    if (pipeline) {
      try {
        const result = await api.getPipeline(pipeline.id);
        setPreview(result.yaml);
      } catch (e) {
        setError((e as Error).message);
      }
      return;
    }

    const mode = getInterpretMode(entry.name);
    if (mode === "image" || mode === "pdf") {
      setFileContent("binary");
      return;
    }

    try {
      const result = await api.readFile(entry.path);
      setFileContent(result.tooBig ? "tooBig" : result.content);
    } catch {
      setFileContent("binary");
    }
  };

  const toggleHidden = async () => {
    const next = !showHidden;
    setShowHidden(next);
    await loadDir(cwd, next);
  };

  const interpretMode = selected ? getInterpretMode(selected.name) : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: "100%" }}>
      {/* ── Sidebar ── */}
      <div style={{ borderRight: "1px solid var(--border)", overflowY: "auto", padding: "12px 8px" }}>
        <div style={{ padding: "4px 8px 8px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600, flex: 1 }}>
            Files
          </span>
          <button type="button" style={{ ...btnGhost, padding: "2px 6px" }} onClick={() => loadDir(cwd, showHidden)} title="Refresh">{Icons.refresh}</button>
          <button type="button" style={{ ...btnGhost, padding: "2px 6px" }} onClick={toggleHidden} title="Toggle hidden files">
            {showHidden ? Icons.eye : Icons.file}
          </button>
        </div>

        <div className="mono" style={{ padding: "0 8px 10px", fontSize: 11, color: "var(--fg-muted)", overflowWrap: "anywhere" }}>
          {cwd || "Loading..."}
        </div>

        {parent && parent !== cwd && (
          <button type="button" onClick={() => loadDir(parent, showHidden)} style={entryStyle(false)}>
            <span style={{ color: "var(--cyan-600)" }}>{Icons.folder}</span>
            <span style={{ flex: 1 }}>..</span>
          </button>
        )}

        {loading && <div style={{ padding: 12, color: "var(--fg-muted)", fontSize: 12.5 }}>Loading...</div>}
        {error && <div style={{ padding: 12, color: "var(--err)", fontSize: 12.5 }}>{error}</div>}
        {!loading && entries.length === 0 && !error && (
          <div style={{ padding: 12, color: "var(--fg-muted)", fontSize: 12.5 }}>No entries.</div>
        )}

        {entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => selectEntry(entry)}
            style={entryStyle(selected?.path === entry.path)}
          >
            <span style={{ color: entry.isDir ? "var(--cyan-600)" : "var(--fg-dim)" }}>
              {entry.isDir ? Icons.folder : Icons.file}
            </span>
            <span style={{ flex: 1 }} className={entry.isYaml ? "mono" : undefined}>
              {entry.name}
            </span>
            {entry.isYaml && <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-dim)" }}>yaml</span>}
          </button>
        ))}
      </div>

      {/* ── Preview panel ── */}
      <div style={{ overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ color: "var(--fg-dim)" }}>{Icons.file}</span>
          <span className="mono" style={{ fontSize: 13, overflowWrap: "anywhere" }}>{selected?.path ?? cwd}</span>
          <div style={{ flex: 1 }} />
          {interpretMode && (
            <button
              type="button"
              style={btnGhost}
              onClick={() => setInterpreted((v) => !v)}
            >
              {interpreted ? Icons.file : Icons.eye}
              <span style={{ marginLeft: 6 }}>{interpreted ? "Raw" : "Interpretar"}</span>
            </button>
          )}
          {selectedPipeline && (
            <button type="button" style={btnGhost} onClick={() => { window.location.hash = `#/pipelines/${selectedPipeline.id}`; }}>
              {Icons.edit}<span style={{ marginLeft: 6 }}>Open pipeline</span>
            </button>
          )}
        </div>

        <div style={{ padding: "16px 20px", flex: 1 }}>
          <PreviewContent
            selected={selected}
            preview={preview}
            fileContent={fileContent}
            interpretMode={interpretMode}
            interpreted={interpreted}
          />
        </div>
      </div>
    </div>
  );
}

type PreviewProps = {
  selected: FsEntry | null;
  preview: string | null;
  fileContent: string | null | "binary" | "tooBig";
  interpretMode: InterpretMode | null;
  interpreted: boolean;
};

function PreviewContent({ selected, preview, fileContent, interpretMode, interpreted }: PreviewProps) {
  if (!selected) {
    return <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>Select a file to preview its contents.</div>;
  }

  // Pipeline YAML (existing behaviour)
  if (preview != null) {
    return (
      <pre style={{ maxWidth: 900, fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.55, color: "var(--fg)", margin: 0, whiteSpace: "pre-wrap" }}>
        {preview}
      </pre>
    );
  }

  // ── Interpreted views ──
  if (interpreted && interpretMode === "image") {
    return (
      <img
        src={api.serveUrl(selected.path)}
        alt={selected.name}
        style={{ maxWidth: "100%", borderRadius: "var(--r-sm)", display: "block" }}
      />
    );
  }

  if (interpreted && interpretMode === "pdf") {
    return (
      <iframe
        src={api.serveUrl(selected.path)}
        title={selected.name}
        style={{ width: "100%", height: "80vh", border: "none", borderRadius: "var(--r-sm)" }}
      />
    );
  }

  if (interpreted && interpretMode === "html") {
    return (
      <iframe
        sandbox="allow-scripts"
        src={api.serveUrl(selected.path)}
        title={selected.name}
        style={{ width: "100%", height: "80vh", border: "1px solid var(--border)", borderRadius: "var(--r-sm)" }}
      />
    );
  }

  if (interpreted && interpretMode === "markdown" && typeof fileContent === "string") {
    return (
      <div
        className="md-render"
        // marked.parse is synchronous for string input without async options
        dangerouslySetInnerHTML={{ __html: marked.parse(fileContent) as string }}
      />
    );
  }

  // ── Raw / error states ──
  if (fileContent === "tooBig") {
    return <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>File is too large to preview (&gt;1 MB).</div>;
  }

  if (fileContent === "binary") {
    if (interpretMode === "image" || interpretMode === "pdf") {
      return <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>Haz clic en "Interpretar" para visualizar este archivo.</div>;
    }
    return <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>Binary file — cannot preview.</div>;
  }

  if (fileContent === null) {
    return <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>Loading…</div>;
  }

  // ── Syntax highlighted text ──
  const ext = selected.name.split(".").pop()?.toLowerCase() ?? "";
  const lang = EXT_LANG[ext];
  const highlighted = lang
    ? hljs.highlight(fileContent, { language: lang }).value
    : hljs.highlightAuto(fileContent, Object.values(EXT_LANG)).value;

  return (
    <pre style={{ maxWidth: 900, margin: 0, padding: 0, background: "transparent", overflowX: "auto" }}>
      <code
        className={lang ? `language-${lang}` : undefined}
        style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-all" }}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </pre>
  );
}

function entryStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    padding: "4px 6px",
    background: active ? "var(--bg-card)" : "transparent",
    borderRadius: "var(--r-sm)",
    fontSize: 12.5,
    color: "var(--fg)",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    marginBottom: 1,
    fontFamily: "inherit",
  };
}
