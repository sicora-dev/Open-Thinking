import { useCallback, useEffect, useMemo, useState } from "react";
import { Icons } from "../components/Icons";
import { api, type FsEntry, type PipelineEntry } from "../lib/api";

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

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: "100%" }}>
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
          <button
            type="button"
            onClick={() => loadDir(parent, showHidden)}
            style={entryStyle(false)}
          >
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

      <div style={{ overflowY: "auto" }}>
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "var(--fg-dim)" }}>{Icons.file}</span>
          <span className="mono" style={{ fontSize: 13, overflowWrap: "anywhere" }}>{selected?.path ?? cwd}</span>
          <div style={{ flex: 1 }} />
          {selectedPipeline && (
            <button type="button" style={btnGhost} onClick={() => { window.location.hash = `#/pipelines/${selectedPipeline.id}`; }}>
              {Icons.edit}<span style={{ marginLeft: 6 }}>Open pipeline</span>
            </button>
          )}
        </div>
        <div style={{ padding: "16px 20px" }}>
          {!selected ? (
            <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>Select a file to preview its contents.</div>
          ) : preview != null ? (
            <pre style={{
              maxWidth: 900, fontFamily: "var(--font-mono)", fontSize: 12.5,
              lineHeight: 1.55, color: "var(--fg)", margin: 0, whiteSpace: "pre-wrap",
            }}>
              {preview}
            </pre>
          ) : fileContent === "tooBig" ? (
            <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>File is too large to preview (&gt;1 MB).</div>
          ) : fileContent === "binary" ? (
            <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>Binary file — cannot preview.</div>
          ) : fileContent != null ? (
            <pre style={{
              maxWidth: 900, fontFamily: "var(--font-mono)", fontSize: 12.5,
              lineHeight: 1.55, color: "var(--fg)", margin: 0, whiteSpace: "pre-wrap",
            }}>
              {fileContent}
            </pre>
          ) : selected ? (
            <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>Loading…</div>
          ) : null}
        </div>
      </div>
    </div>
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
