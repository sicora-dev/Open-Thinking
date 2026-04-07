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
    <div className="p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-medium">Projects</h1>
          <p className="text-xs text-ink-400 mt-0.5">
            Registered project roots. Each project manages its own <code>.openthk/pipelines</code> and <code>.openthk/pipelines/skills</code>.
          </p>
        </div>
        <button className="btn-accent" onClick={() => setShowAdd(true)}>
          Add project
        </button>
      </header>

      {error && <div className="panel p-3 text-red-400 text-sm mb-4">{error}</div>}

      <div className="panel">
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
            <thead className="text-left text-ink-400">
              <tr className="border-b border-ink-700">
                <th className="px-4 py-2 font-normal">Name</th>
                <th className="px-4 py-2 font-normal">Path</th>
                <th className="px-4 py-2 font-normal">Pipelines</th>
                <th className="px-4 py-2 font-normal">Skills</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id} className="border-b border-ink-700/50">
                  <td className="px-4 py-2">{project.name}</td>
                  <td className="px-4 py-2 text-ink-400 font-mono text-xs truncate max-w-md">{project.path}</td>
                  <td className="px-4 py-2 text-ink-400">{project.pipelinesCount}</td>
                  <td className="px-4 py-2 text-ink-400">{project.skillsCount}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2 justify-end">
                      <button className="btn !py-1 !px-2" onClick={() => (window.location.hash = `#/projects/${project.id}`)}>
                        Open
                      </button>
                      <button className="btn !py-1 !px-2" onClick={() => removeProject(project)}>
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
