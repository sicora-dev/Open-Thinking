import { useEffect, useState } from "react";
import { PathPicker } from "../components/PathPicker";
import { EmptyState } from "../components/EmptyState";
import { useToast } from "../components/ToastProvider";
import { api, type ProjectEntry } from "../lib/api";

export function Projects() {
  const { pushToast } = useToast();
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = () => {
    setError(null);
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => {
        const message = (e as Error).message;
        setError(message);
        pushToast({ kind: "error", title: "Could not load projects", description: message });
      });
  };

  useEffect(() => {
    load();
  }, []);

  const removeProject = async (project: ProjectEntry) => {
    if (!confirm(`Unregister project ${project.name}?`)) return;
    try {
      await api.removeProject(project.id);
      pushToast({ kind: "success", title: "Project removed", description: project.name });
      load();
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not remove project", description: message });
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <p className="text-xs text-ink-400">
          Each project manages its own <code className="text-ink-300">.openthk/pipelines</code>
        </p>
        <button className="btn-accent" onClick={() => setShowAdd(true)}>
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add project
        </button>
      </div>

      {error && <div className="panel p-3 text-red-400 text-sm mb-4">{error}</div>}

      <div className="panel overflow-hidden">
        {projects.length === 0 ? (
          <EmptyState
            title="No projects registered"
            description="Add a project root to work with its local pipelines and skills."
            action={
              <button className="btn-accent" onClick={() => setShowAdd(true)}>
                Add project
              </button>
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-700/50 bg-ink-900/40">
                <th className="px-4 py-3 text-left label">Name</th>
                <th className="px-4 py-3 text-left label">Path</th>
                <th className="px-4 py-3 text-right label">Pipelines</th>
                <th className="px-4 py-3 text-right label">Skills</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr
                  key={project.id}
                  className="border-b border-ink-700/30 last:border-0 hover:bg-ink-800/30 transition-colors cursor-pointer"
                  onClick={() => (window.location.hash = `#/projects/${project.id}`)}
                >
                  <td className="px-4 py-3 font-medium text-ink-100">{project.name}</td>
                  <td className="px-4 py-3 text-ink-400 font-mono text-xs truncate max-w-md" title={project.path}>{project.path}</td>
                  <td className="px-4 py-3 text-right text-xs font-mono text-ink-300">{project.pipelinesCount}</td>
                  <td className="px-4 py-3 text-right text-xs font-mono text-ink-300">{project.skillsCount}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1.5 justify-end">
                      <button className="btn-ghost !px-2.5 !py-1 !text-xs" onClick={() => (window.location.hash = `#/projects/${project.id}`)}>
                        Open
                      </button>
                      <button className="btn-ghost !px-2.5 !py-1 !text-xs hover:!text-red-400" onClick={() => removeProject(project)}>
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

      {showAdd && (
        <PathPicker
          mode="dir"
          onClose={() => setShowAdd(false)}
          onPick={async (path) => {
            try {
              const result = await api.addProject(path);
              setShowAdd(false);
              pushToast({ kind: "success", title: "Project added", description: result.project.name });
              load();
              window.location.hash = `#/projects/${result.project.id}`;
            } catch (e) {
              const message = (e as Error).message;
              setError(message);
              pushToast({ kind: "error", title: "Could not add project", description: message });
            }
          }}
        />
      )}
    </div>
  );
}
