import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/ToastProvider";
import { api, type PipelineEntry } from "../lib/api";

const STARTER_YAML = (name: string) => `name: ${name}
version: "0.1.0"
mode: sequential

providers:
  - openai

stages:
  echo:
    provider: openai
    model: gpt-4o
    skill: core/echo@1.0
    context:
      read: ["input.*"]
      write: ["echo.*"]
`;

export function Pipelines() {
  const { pushToast } = useToast();
  const [pipelines, setPipelines] = useState<PipelineEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [runDialog, setRunDialog] = useState<PipelineEntry | null>(null);

  const load = () => {
    setError(null);
    api
      .listPipelines()
      .then(setPipelines)
      .catch((e) => {
        const message = (e as Error).message;
        setError(message);
        pushToast({ kind: "error", title: "Could not load pipelines", description: message });
      });
  };

  useEffect(() => {
    load();
  }, []);

  const onDelete = async (id: string) => {
    if (!confirm("Delete this global pipeline?")) return;
    try {
      await api.deletePipeline(id);
      pushToast({ kind: "success", title: "Pipeline deleted" });
      load();
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not remove pipeline", description: message });
    }
  };

  return (
    <div className="p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-medium">Pipelines</h1>
          <p className="text-xs text-ink-400 mt-0.5">
            Global pipelines stored in <code>~/.openthk/pipelines</code>.
          </p>
        </div>
        <button className="btn-accent" onClick={() => setShowCreate(true)}>
          New pipeline
        </button>
      </header>

      {error && (
        <div className="panel p-3 text-red-400 text-sm mb-4">{error}</div>
      )}

      <div className="panel">
        {pipelines.length === 0 ? (
          <EmptyState
            title="No pipelines yet"
            description="Create a global pipeline here, or switch to Projects to manage project-local pipelines."
            action={
              <button className="btn-accent" onClick={() => setShowCreate(true)}>
                New pipeline
              </button>
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-ink-400">
              <tr className="border-b border-ink-700">
                <th className="px-4 py-2 font-normal">Name</th>
                <th className="px-4 py-2 font-normal">Path</th>
                <th className="px-4 py-2 font-normal">Last opened</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {pipelines.map((p) => (
                <tr key={p.id} className="border-b border-ink-700/50">
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2 text-ink-400 font-mono text-xs truncate max-w-md">
                    {p.path}
                  </td>
                  <td className="px-4 py-2 text-ink-400 text-xs">
                    {p.lastOpenedAt ? new Date(p.lastOpenedAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex gap-2 justify-end">
                      <button
                        className="btn !py-1 !px-2"
                        onClick={() => {
                          window.location.hash = `#/pipelines/${p.id}`;
                        }}
                      >
                        Edit
                      </button>
                      <button className="btn !py-1 !px-2" onClick={() => setRunDialog(p)}>
                        Run
                      </button>
                      <button
                        className="btn !py-1 !px-2"
                        onClick={() => onDelete(p.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreatePipelineModal
          onClose={() => setShowCreate(false)}
          onCreated={(pipelineId) => {
            setShowCreate(false);
            load();
            pushToast({ kind: "success", title: "Pipeline created" });
            window.location.hash = `#/pipelines/${pipelineId}`;
          }}
        />
      )}

      {runDialog && (
        <RunDialog
          pipeline={runDialog}
          onClose={() => setRunDialog(null)}
          onStarted={(runId) => {
            pushToast({ kind: "success", title: "Run started", description: runId });
            window.location.hash = `#/runs/${runId}`;
          }}
        />
      )}
    </div>
  );
}

function CreatePipelineModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (pipelineId: string) => void;
}) {
  const { pushToast } = useToast();
  const [name, setName] = useState("global-pipeline");
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    if (!name) {
      setError("Name is required.");
      return;
    }
    try {
      const result = await api.createGlobalPipeline(name, STARTER_YAML(name));
      onCreated(result.pipeline.id);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not create pipeline", description: message });
    }
  };

  return (
    <div className="fixed inset-0 z-40 overlay-scrim flex items-center justify-center p-6">
      <div className="panel w-full max-w-md">
        <div className="px-4 py-3 border-b border-ink-700 flex items-center justify-between">
          <div className="text-sm font-medium">New pipeline</div>
          <button className="text-ink-400 hover:text-ink-100 text-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="label block mb-1">Name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="text-[11px] text-ink-400">
            The file will be saved in <code>~/.openthk/pipelines</code>.
          </div>
          {error && <div className="text-red-400 text-xs">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-ink-700 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-accent" onClick={create}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function RunDialog({
  pipeline,
  onClose,
  onStarted,
}: {
  pipeline: PipelineEntry;
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const { pushToast } = useToast();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!input.trim()) {
      setError("Input is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.runPipeline(pipeline.id, input);
      onStarted(r.runId);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not start run", description: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 overlay-scrim flex items-center justify-center p-6">
      <div className="panel w-full max-w-lg">
        <div className="px-4 py-3 border-b border-ink-700 flex items-center justify-between">
          <div className="text-sm font-medium">Run {pipeline.name}</div>
          <button className="text-ink-400 hover:text-ink-100 text-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-4 space-y-3">
          <label className="label block mb-1">Input prompt</label>
          <textarea
            className="input font-mono text-xs"
            rows={6}
            value={input}
            placeholder="Describe what the pipeline should do..."
            onChange={(e) => setInput(e.target.value)}
          />
          {error && <div className="text-red-400 text-xs">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-ink-700 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-accent" disabled={busy} onClick={run}>
            {busy ? "Starting..." : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
