import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/ToastProvider";
import { api, type RunRow } from "../lib/api";

const STATUS_BADGE: Record<string, string> = {
  running: "badge badge-accent",
  success: "badge badge-success",
  failed: "badge badge-error",
  cancelled: "badge badge-warning",
};

const STATUS_DOT: Record<string, string> = {
  running: "bg-accent animate-pulse-soft",
  success: "bg-green-500",
  failed: "bg-red-500",
  cancelled: "bg-orange-500",
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function Runs() {
  const { pushToast } = useToast();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api.listRuns().then(setRuns).catch((e) => {
        const message = (e as Error).message;
        setError(message);
        pushToast({ kind: "error", title: "Could not load runs", description: message });
      });
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [pushToast]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {error && <div className="panel p-3 text-red-400 text-sm mb-4">{error}</div>}

      <div className="panel overflow-hidden">
        {runs.length === 0 ? (
          <EmptyState
            title="No runs yet"
            description="Trigger one from the Pipelines view or from the visual editor."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-700/50 bg-ink-900/40">
                <th className="px-4 py-3 text-left label">Pipeline</th>
                <th className="px-4 py-3 text-left label">Status</th>
                <th className="px-4 py-3 text-left label">Started</th>
                <th className="px-4 py-3 text-right label">Tokens</th>
                <th className="px-4 py-3 text-right label">Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-ink-700/30 last:border-0 row-hover"
                  onClick={() => (window.location.hash = `#/runs/${r.id}`)}
                >
                  <td className="px-4 py-3 font-medium text-ink-100">{r.pipelineName}</td>
                  <td className="px-4 py-3">
                    <span className={STATUS_BADGE[r.status] ?? "badge"}>
                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[r.status] ?? "bg-ink-500"}`} />
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-400 text-xs" title={new Date(r.startedAt).toLocaleString()}>
                    {formatRelative(r.startedAt)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-mono text-ink-300">
                    {r.totalTokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-mono text-ink-300">
                    ${r.totalCost.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
