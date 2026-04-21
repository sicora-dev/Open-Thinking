import { useCallback, useEffect, useMemo, useState } from "react";
import { Icons } from "../components/Icons";
import { api, type ContextEntry, type ContextStoreInfo } from "../lib/api";
import { formatRelative } from "../lib/run-events";

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

type FlatEntry = ContextEntry & {
  projectId: string;
  projectName: string;
  dbPath: string;
};

export function ContextStore() {
  const [stores, setStores] = useState<ContextStoreInfo[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStores(await api.listContext());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const entries = useMemo(() => {
    const all = stores.flatMap((store) =>
      store.entries.map((entry) => ({
        ...entry,
        projectId: store.projectId,
        projectName: store.projectName,
        dbPath: store.dbPath,
      })),
    );
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    const prefix = q.endsWith("*") ? q.slice(0, -1) : null;
    return all.filter((entry) => {
      if (prefix) return entry.key.toLowerCase().startsWith(prefix);
      return [entry.key, entry.value, entry.createdBy, entry.projectName]
        .some((value) => value.toLowerCase().includes(q));
    });
  }, [filter, stores]);

  const prefixes = useMemo(() => {
    const names = new Set<string>();
    for (const entry of stores.flatMap((store) => store.entries)) {
      const [first] = entry.key.split(".");
      if (first) names.add(`${first}.*`);
    }
    return [...names].sort().slice(0, 6);
  }, [stores]);

  const totalBytes = stores.reduce(
    (sum, store) => sum + store.entries.reduce((inner, entry) => inner + entry.value.length, 0),
    0,
  );

  return (
    <div style={{ padding: "24px 28px 60px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, margin: 0 }}>Context store</h1>
          <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: "4px 0 0" }}>
            {loading ? "Loading context stores..." : `${stores.length} project store${stores.length === 1 ? "" : "s"} · ${stores.reduce((sum, store) => sum + store.entries.length, 0)} keys · ${formatBytes(totalBytes)}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btnGhost} onClick={load}>{Icons.refresh}<span style={{ marginLeft: 6 }}>Refresh</span></button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{
          flex: 1, background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: "var(--r-md)", display: "flex", alignItems: "center", padding: "6px 10px",
        }}>
          <span style={{ color: "var(--fg-dim)", marginRight: 8 }}>{Icons.search}</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by key, value, creator, or project"
            style={{
              flex: 1, border: "none", outline: "none", background: "transparent",
              fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--fg)",
            }}
          />
        </div>
        {prefixes.map((prefix) => (
          <button key={prefix} type="button" onClick={() => setFilter(prefix)} style={{ ...btnGhost, fontFamily: "var(--font-mono)", fontSize: 12 }}>{prefix}</button>
        ))}
      </div>

      {error && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--err)", borderRadius: "var(--r-lg)", padding: 12, marginBottom: 16, color: "var(--err)", fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
        {entries.length === 0 ? (
          <div style={{ padding: 24, fontSize: 13, color: "var(--fg-muted)" }}>
            {stores.length === 0 ? "No registered project context stores were returned by the API." : "No context entries match the current filter."}
          </div>
        ) : (
          entries.map((entry, index) => (
            <ContextRow key={`${entry.projectId}-${entry.key}`} entry={entry} last={index === entries.length - 1} />
          ))
        )}
      </div>
    </div>
  );
}

function ContextRow({ entry, last }: { entry: FlatEntry; last: boolean }) {
  return (
    <div style={{ padding: "12px 16px", borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 13, fontWeight: 500, color: "var(--cyan-700)" }}>{entry.key}</span>
        <span style={{
          fontSize: 10.5, padding: "1px 6px", background: "var(--bg-soft)",
          border: "1px solid var(--border)", borderRadius: 3, color: "var(--fg-muted)",
        }}>by {entry.createdBy}</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--fg-dim)" }}>{formatBytes(entry.value.length)}</span>
        <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>{entry.projectName}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>{formatRelative(entry.createdAt)}</span>
        <button type="button" style={{ ...btnGhost, padding: "2px 6px" }} onClick={() => navigator.clipboard.writeText(entry.value)}>{Icons.copy}</button>
      </div>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-muted)",
        background: "var(--bg-soft)", borderRadius: "var(--r-sm)", padding: "8px 10px",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.5,
      }}>{entry.value}</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
