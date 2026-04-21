import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { Icons } from "../components/Icons";
import { useToast } from "../components/ToastProvider";
import { api, type ProviderInfo } from "../lib/api";

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

export function Providers() {
  const { pushToast } = useToast();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [editing, setEditing] = useState<ProviderInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .listProviders()
      .then(setProviders)
      .catch((e) => {
        const message = (e as Error).message;
        setError(message);
        pushToast({ kind: "error", title: "Could not load providers", description: message });
      });

  useEffect(() => {
    load();
  }, [pushToast]);

  const onRemove = async (id: string) => {
    if (!confirm("Remove this API key?")) return;
    try {
      await api.removeProvider(id);
      pushToast({ kind: "success", title: "Provider key removed" });
      load();
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not remove provider key", description: message });
    }
  };

  return (
    <div style={{ padding: "24px 28px 60px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, margin: 0 }}>Providers</h1>
          <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: "4px 0 0" }}>
            API keys stored in <span className="mono">~/.openthk/providers.json</span> &middot; shared across projects.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btnGhost} onClick={load}>
            {Icons.refresh}<span style={{ marginLeft: 6 }}>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: 12, marginBottom: 16, background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.2)", borderRadius: "var(--r-md)",
          fontSize: 13, color: "var(--err)",
        }}>
          {error}
        </div>
      )}

      {providers.length === 0 ? (
        <div className="panel">
          <EmptyState
            title="No providers discovered"
            description="The catalog should always be available. If this is empty, the UI failed to load provider metadata."
          />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} onEdit={setEditing} onRemove={onRemove} />
          ))}
        </div>
      )}

      {editing && (
        <KeyModal
          provider={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            pushToast({ kind: "success", title: "Provider key saved" });
          }}
        />
      )}
    </div>
  );
}

function ProviderCard({
  provider: p,
  onEdit,
  onRemove,
}: {
  provider: ProviderInfo;
  onEdit: (p: ProviderInfo) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--border)",
      borderRadius: "var(--r-lg)", padding: 16,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: "var(--r-sm)",
          background: "var(--bg-soft)", border: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 600, color: "var(--fg-muted)",
          fontFamily: "var(--font-mono)",
        }}>
          {p.name.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>
            {p.id} &middot; {p.category}
          </div>
        </div>
        <span style={{
          fontSize: 11, padding: "2px 8px", borderRadius: 10,
          background: p.configured ? "rgba(16,185,129,0.08)" : "var(--bg-soft)",
          color: p.configured ? "var(--ok)" : "var(--fg-dim)",
          display: "flex", alignItems: "center", gap: 4,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: 3, background: "currentColor" }} />
          {p.configured ? "configured" : "not configured"}
        </span>
      </div>

      {/* Description */}
      <div style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 10, lineHeight: 1.4 }}>
        {p.description}
      </div>

      {/* Base URL */}
      <div className="mono" style={{
        fontSize: 11, color: "var(--fg-dim)", marginBottom: 12,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {p.baseUrl}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={() => onEdit(p)}
          style={{ ...btnGhost, flex: 1, justifyContent: "center" }}
        >
          {p.configured ? "Update key" : "Add key"}
        </button>
        {p.configured && (
          <button
            type="button"
            onClick={() => onRemove(p.id)}
            style={btnGhost}
          >
            {Icons.trash}
          </button>
        )}
      </div>
    </div>
  );
}

function KeyModal({
  provider,
  onClose,
  onSaved,
}: {
  provider: ProviderInfo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pushToast } = useToast();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!key.trim()) return setError("Key is required.");
    try {
      await api.saveProvider(provider.id, key.trim());
      onSaved();
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not save provider key", description: message });
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 440,
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{provider.name} API key</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none", background: "transparent",
              color: "var(--fg-muted)", cursor: "pointer", padding: 2,
            }}
          >
            {Icons.x}
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16 }}>
          <input
            type="password"
            placeholder="sk-..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            style={{
              width: "100%", padding: "8px 12px",
              background: "var(--bg-soft)", border: "1px solid var(--border)",
              borderRadius: "var(--r-md)", fontSize: 13,
              fontFamily: "var(--font-mono)", color: "var(--fg)",
              outline: "none",
            }}
          />
          {provider.signupUrl && (
            <div style={{ fontSize: 11.5, color: "var(--fg-dim)", marginTop: 8 }}>
              Get a key at{" "}
              <a
                href={provider.signupUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--cyan-600)", textDecoration: "none" }}
              >
                {provider.signupUrl}
              </a>
            </div>
          )}
          {error && (
            <div style={{ fontSize: 12, color: "var(--err)", marginTop: 8 }}>{error}</div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 16px", borderTop: "1px solid var(--border)",
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 14px", background: "var(--bg-card)",
              border: "1px solid var(--border)", borderRadius: "var(--r-sm)",
              fontSize: 13, color: "var(--fg)", cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            style={{
              padding: "6px 14px", background: "var(--cyan-500)",
              border: "none", borderRadius: "var(--r-sm)",
              fontSize: 13, color: "#fff", fontWeight: 500, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
