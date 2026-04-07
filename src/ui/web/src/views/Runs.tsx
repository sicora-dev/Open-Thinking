import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/ToastProvider";
import { api, type RunRow } from "../lib/api";

const STATUS_COLOR: Record<string, string> = {
  running: "text-accent",
  success: "text-green-400",
  failed: "text-red-400",
  cancelled: "text-yellow-400",
};

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
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-lg font-medium">Runs</h1>
        <p className="text-xs text-ink-400 mt-0.5">Pipeline execution history.</p>
      </header>

      {error && <div className="panel p-3 text-red-400 text-sm mb-4">{error}</div>}

      <div className="panel">
        {runs.length === 0 ? (
          <EmptyState
            title="No runs yet"
            description="Trigger one from the Pipelines view or from the visual editor."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-ink-400">
              <tr className="border-b border-ink-700">
                <th className="px-4 py-2 font-normal">Pipeline</th>
                <th className="px-4 py-2 font-normal">Status</th>
                <th className="px-4 py-2 font-normal">Started</th>
                <th className="px-4 py-2 font-normal">Tokens</th>
                <th className="px-4 py-2 font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-ink-700/50 row-hover"
                  onClick={() => (window.location.hash = `#/runs/${r.id}`)}
                >
                  <td className="px-4 py-2">{r.pipelineName}</td>
                  <td className={`px-4 py-2 ${STATUS_COLOR[r.status] ?? ""}`}>
                    {r.status}
                  </td>
                  <td className="px-4 py-2 text-ink-400 text-xs">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.totalTokens.toLocaleString()}</td>
                  <td className="px-4 py-2 text-xs">${r.totalCost.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
