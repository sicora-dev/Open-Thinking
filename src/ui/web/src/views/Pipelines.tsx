import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/ToastProvider";
import { api, type PipelineEntry, type ProjectEntry } from "../lib/api";
import {
  resolveSelectedWorkspaceProjectId,
  writeSelectedWorkspaceProjectId,
} from "../lib/workspace-selection";

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
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [runDialog, setRunDialog] = useState<PipelineEntry | null>(null);

  const load = () => {
    setError(null);
    Promise.all([api.listPipelines(), api.listProjects()])
      .then(([nextPipelines, nextProjects]) => {
        setPipelines(nextPipelines);
        setProjects(nextProjects);
      })
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
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <p className="text-xs text-ink-400">
          Stored in <code className="text-ink-300">~/.openthk/pipelines</code>
        </p>
        <button className="btn-accent" onClick={() => setShowCreate(true)}>
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New pipeline
        </button>
      </div>

      {error && (
        <div className="panel p-3 text-red-400 text-sm mb-4">{error}</div>
      )}

      <div className="panel overflow-hidden">
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
            <thead>
              <tr className="border-b border-ink-700/50 bg-ink-900/40">
                <th className="px-4 py-3 text-left label">Name</th>
                <th className="px-4 py-3 text-left label">Path</th>
                <th className="px-4 py-3 text-left label">Last opened</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {pipelines.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-ink-700/30 last:border-0 hover:bg-ink-800/30 transition-colors cursor-pointer"
                  onClick={() => {
                    window.location.hash = `#/pipelines/${p.id}`;
                  }}
                >
                  <td className="px-4 py-3 font-medium text-ink-100">{p.name}</td>
                  <td className="px-4 py-3 text-ink-400 font-mono text-xs truncate max-w-md" title={p.path}>
                    {p.path}
                  </td>
                  <td className="px-4 py-3 text-ink-400 text-xs">
                    {p.lastOpenedAt ? new Date(p.lastOpenedAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1.5 justify-end">
                      <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => setRunDialog(p)}>
                        Run
                      </button>
                      <button
                        className="btn-ghost !px-2.5 !py-1 !text-xs hover:!text-red-400"
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
          projects={projects}
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
  projects,
  onClose,
  onStarted,
}: {
  pipeline: PipelineEntry;
  projects: ProjectEntry[];
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const { pushToast } = useToast();
  const [input, setInput] = useState("");
  const [projectId, setProjectId] = useState(() =>
    resolveSelectedWorkspaceProjectId(projects),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProjectId((current) => resolveSelectedWorkspaceProjectId(projects, current));
  }, [projects]);

  const selectedProject = projects.find((project) => project.id === projectId) ?? null;

  const run = async () => {
    if (!input.trim()) {
      setError("Input is required.");
      return;
    }
    if (projects.length > 0 && !selectedProject) {
      setError("Select a workspace before starting the run.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (selectedProject) writeSelectedWorkspaceProjectId(selectedProject.id);
      const r = await api.runPipeline(pipeline.id, input.trim(), {
        projectId: selectedProject?.id,
      });
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
          <div>
            <label className="label block mb-1">Workspace</label>
            {projects.length === 0 ? (
              <div className="rounded-md border border-ink-700 bg-ink-900/50 px-3 py-2 text-xs text-ink-400">
                No project workspaces registered. This run will use the pipeline location.
              </div>
            ) : (
              <>
                <select
                  className="input"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  disabled={busy}
                >
                  <option value="">Select workspace…</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} ({project.path})
                    </option>
                  ))}
                </select>
                {selectedProject && (
                  <div className="mt-1 text-[11px] text-ink-400 font-mono truncate" title={selectedProject.path}>
                    {selectedProject.path}
                  </div>
                )}
              </>
            )}
          </div>
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
          <button className="btn-accent" disabled={busy || (projects.length > 0 && !selectedProject)} onClick={run}>
            {busy ? "Starting..." : "Run"}
          </button>
        </div>
      </div>
    </div>
  );
}
