import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/ToastProvider";
import { api, type ProviderInfo } from "../lib/api";

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

  const cloud = providers.filter((p) => p.category === "cloud");
  const local = providers.filter((p) => p.category === "local");

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-lg font-medium">Providers</h1>
        <p className="text-xs text-ink-400 mt-0.5">
          API keys are stored at <code>~/.openthk/providers.json</code>.
        </p>
      </header>

      {error && <div className="panel p-3 text-red-400 text-sm mb-4">{error}</div>}

      {providers.length === 0 ? (
        <div className="panel">
          <EmptyState
            title="No providers discovered"
            description="The catalog should always be available. If this is empty, the UI failed to load provider metadata."
          />
        </div>
      ) : (
        <>
          <Section title="Cloud" providers={cloud} onEdit={setEditing} onRemove={onRemove} />
          <div className="h-6" />
          <Section title="Local" providers={local} onEdit={setEditing} onRemove={onRemove} />
        </>
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

function Section({
  title,
  providers,
  onEdit,
  onRemove,
}: {
  title: string;
  providers: ProviderInfo[];
  onEdit: (p: ProviderInfo) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div>
      <div className="label mb-2">{title}</div>
      <div className="panel grid grid-cols-1 md:grid-cols-2 gap-px bg-ink-700">
        {providers.map((p) => (
          <div key={p.id} className="bg-ink-900 p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{p.name}</span>
                {p.configured && (
                  <span className="text-[10px] uppercase tracking-wider text-accent border border-accent/50 px-1">
                    configured
                  </span>
                )}
              </div>
              <div className="text-xs text-ink-400 mt-0.5 truncate">{p.description}</div>
              <div className="text-[11px] text-ink-400 font-mono mt-1 truncate">{p.baseUrl}</div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <button className="btn !py-1 !px-2 text-xs" onClick={() => onEdit(p)}>
                {p.configured ? "Update" : "Add key"}
              </button>
              {p.configured && (
                <button
                  className="btn !py-1 !px-2 text-xs"
                  onClick={() => onRemove(p.id)}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
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
    <div className="fixed inset-0 z-40 overlay-scrim flex items-center justify-center p-6">
      <div className="panel w-full max-w-md">
        <div className="px-4 py-3 border-b border-ink-700 flex items-center justify-between">
          <div className="text-sm font-medium">{provider.name} API key</div>
          <button className="text-ink-400 hover:text-ink-100 text-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-4 space-y-3">
          <input
            className="input font-mono"
            type="password"
            placeholder="sk-..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          {provider.signupUrl && (
            <div className="text-[11px] text-ink-400">
              Get a key at{" "}
              <a
                className="text-accent hover:underline"
                href={provider.signupUrl}
                target="_blank"
                rel="noreferrer"
              >
                {provider.signupUrl}
              </a>
            </div>
          )}
          {error && <div className="text-red-400 text-xs">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-ink-700 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-accent" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
