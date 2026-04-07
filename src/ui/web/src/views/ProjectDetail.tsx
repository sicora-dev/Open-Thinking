import { useEffect, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { SkillManager } from "../components/SkillManager";
import { useToast } from "../components/ToastProvider";
import { api, type PipelineEntry, type ProjectEntry } from "../lib/api";

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

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { pushToast } = useToast();
  const [project, setProject] = useState<ProjectEntry | null>(null);
  const [pipelines, setPipelines] = useState<PipelineEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [runDialog, setRunDialog] = useState<PipelineEntry | null>(null);

  const load = () => {
    setError(null);
    Promise.all([api.listProjects(), api.listProjectPipelines(projectId)])
      .then(([projects, projectPipelines]) => {
        const selectedProject = projects.find((entry) => entry.id === projectId) ?? null;
        if (!selectedProject) {
          setProject(null);
          setPipelines([]);
          setError("Project not found.");
          return;
        }

        setProject(selectedProject);
        setPipelines(projectPipelines);
      })
      .catch((e) => {
        const message = (e as Error).message;
        setError(message);
        pushToast({ kind: "error", title: "Could not load project", description: message });
      });
  };

  useEffect(() => {
    load();
  }, [projectId]);

  const deletePipeline = async (pipeline: PipelineEntry) => {
    if (!confirm(`Delete pipeline ${pipeline.name}?`)) return;
    try {
      await api.deletePipeline(pipeline.id);
      pushToast({ kind: "success", title: "Pipeline deleted", description: pipeline.name });
      load();
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not delete pipeline", description: message });
    }
  };

  if (error && !project) {
    return (
      <EmptyState
        title="Project unavailable"
        description={error}
        action={
          <a href="#/projects" className="btn">
            Back to projects
          </a>
        }
      />
    );
  }

  if (!project) {
    return <div className="p-6 text-sm text-ink-400">Loading project…</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 text-sm">
            <a href="#/projects" className="text-ink-400 hover:text-ink-100">
              ← Projects
            </a>
            <span className="text-ink-500">/</span>
            <span className="font-medium">{project.name}</span>
          </div>
          <p className="text-xs text-ink-400 mt-2 font-mono">{project.path}</p>
          <div className="text-[11px] text-ink-400 mt-1">
            Pipelines live in <code>{project.path}/.openthk/pipelines</code> and skills in <code>{project.path}/.openthk/pipelines/skills</code>.
          </div>
        </div>
      </header>

      {error && <div className="panel p-3 text-red-400 text-sm">{error}</div>}

      <section className="panel">
        <div className="px-4 py-3 border-b border-ink-700 flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Project pipelines</div>
            <div className="text-xs text-ink-400 mt-1">
              Stored inside the hidden <code>.openthk/pipelines</code> directory for this project.
            </div>
          </div>
          <button className="btn-accent" onClick={() => setShowCreate(true)}>
            New pipeline
          </button>
        </div>

        {pipelines.length === 0 ? (
          <EmptyState
            title="No project pipelines yet"
            description="Create a local pipeline for this project."
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
              {pipelines.map((pipeline) => (
                <tr key={pipeline.id} className="border-b border-ink-700/50">
                  <td className="px-4 py-2">{pipeline.name}</td>
                  <td className="px-4 py-2 text-ink-400 text-xs font-mono truncate max-w-md">{pipeline.path}</td>
                  <td className="px-4 py-2 text-ink-400 text-xs">
                    {pipeline.lastOpenedAt ? new Date(pipeline.lastOpenedAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2 justify-end">
                      <button className="btn !py-1 !px-2" onClick={() => (window.location.hash = `#/pipelines/${pipeline.id}`)}>
                        Edit
                      </button>
                      <button className="btn !py-1 !px-2" onClick={() => setRunDialog(pipeline)}>
                        Run
                      </button>
                      <button className="btn !py-1 !px-2" onClick={() => deletePipeline(pipeline)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <SkillManager
        projectId={project.id}
        title="Project skills"
        description="Manage the skills stored in this project's ./.openthk/pipelines/skills directory."
        emptyDescription="Create a local skill for this project."
      />

      {showCreate && (
        <CreateProjectPipelineModal
          project={project}
          onClose={() => setShowCreate(false)}
          onCreated={(pipelineId) => {
            setShowCreate(false);
            pushToast({ kind: "success", title: "Project pipeline created" });
            load();
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

function CreateProjectPipelineModal({
  project,
  onClose,
  onCreated,
}: {
  project: ProjectEntry;
  onClose: () => void;
  onCreated: (pipelineId: string) => void;
}) {
  const { pushToast } = useToast();
  const [name, setName] = useState("project-pipeline");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createProjectPipeline(project.id, name, STARTER_YAML(name));
      onCreated(result.pipeline.id);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not create project pipeline", description: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 overlay-scrim flex items-center justify-center p-6">
      <div className="panel w-full max-w-md">
        <div className="px-4 py-3 border-b border-ink-700 flex items-center justify-between">
          <div className="text-sm font-medium">New project pipeline</div>
          <button className="text-ink-400 hover:text-ink-100 text-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="label block mb-1">Name</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="text-[11px] text-ink-400">
            The file will be saved in <code>{project.path}/.openthk/pipelines</code>.
          </div>
          {error && <div className="text-red-400 text-xs">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-ink-700 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-accent" disabled={busy} onClick={create}>
            {busy ? "Creating..." : "Create"}
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
      const result = await api.runPipeline(pipeline.id, input);
      onStarted(result.runId);
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
            onChange={(event) => setInput(event.target.value)}
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
