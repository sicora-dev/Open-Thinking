import { useEffect, useState } from "react";
import { api, type SkillEntry } from "../lib/api";
import { EmptyState } from "./EmptyState";
import { useToast } from "./ToastProvider";

type SkillManagerProps = {
  projectId?: string;
  title?: string;
  description?: string;
  emptyDescription: string;
};

export function SkillManager({
  projectId,
  title,
  description,
  emptyDescription,
}: SkillManagerProps) {
  const { pushToast } = useToast();
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillEntry | null>(null);

  const load = () => {
    setError(null);
    api
      .listSkills(projectId ? { projectId } : undefined)
      .then(setSkills)
      .catch((e) => {
        const message = (e as Error).message;
        setError(message);
        pushToast({ kind: "error", title: "Could not load skills", description: message });
      });
  };

  useEffect(() => {
    load();
  }, [projectId]);

  const deleteSkill = async (skill: SkillEntry) => {
    if (!confirm(`Delete skill ${skill.id}?`)) return;
    try {
      await api.deleteSkill(skill.path);
      pushToast({ kind: "success", title: "Skill deleted", description: skill.id });
      load();
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not delete skill", description: message });
    }
  };

  return (
    <div className="panel">
      {(title || description) && (
        <div className="px-4 py-3 border-b border-ink-700 flex items-start justify-between gap-4">
          <div>
            {title && <div className="text-sm font-medium">{title}</div>}
            {description && <div className="text-xs text-ink-400 mt-1">{description}</div>}
          </div>
          <button className="btn-accent" onClick={() => setShowCreate(true)}>
            New skill
          </button>
        </div>
      )}

      {error && <div className="px-4 py-3 text-red-400 text-sm border-b border-ink-700">{error}</div>}

      {skills.length === 0 ? (
        <EmptyState
          title="No skills found"
          description={emptyDescription}
          action={
            <button className="btn-accent" onClick={() => setShowCreate(true)}>
              New skill
            </button>
          }
        />
      ) : (
        <ul className="text-sm">
          {skills.map((skill) => (
            <li
              key={skill.path}
              className="px-4 py-3 border-b border-ink-700/50 flex items-start justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="font-mono">{skill.id}</div>
                <div className="text-[11px] text-ink-400 font-mono mt-1 truncate">{skill.path}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button className="btn !py-1 !px-2" onClick={() => setEditingSkill(skill)}>
                  Edit
                </button>
                <button className="btn !py-1 !px-2" onClick={() => deleteSkill(skill)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <CreateSkillModal
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={(skill) => {
            setShowCreate(false);
            pushToast({ kind: "success", title: "Skill created", description: skill.id });
            load();
            setEditingSkill(skill);
          }}
        />
      )}

      {editingSkill && (
        <EditSkillModal
          skill={editingSkill}
          onClose={() => setEditingSkill(null)}
          onSaved={() => {
            pushToast({ kind: "success", title: "Skill saved", description: editingSkill.id });
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateSkillModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId?: string;
  onClose: () => void;
  onCreated: (skill: SkillEntry) => void;
}) {
  const { pushToast } = useToast();
  const [namespace, setNamespace] = useState("custom");
  const [name, setName] = useState("new-skill");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createSkill({ namespace, name, projectId });
      onCreated(result.skill);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not create skill", description: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 overlay-scrim flex items-center justify-center p-6">
      <div className="panel w-full max-w-md">
        <div className="px-4 py-3 border-b border-ink-700 flex items-center justify-between">
          <div className="text-sm font-medium">New skill</div>
          <button className="text-ink-400 hover:text-ink-100 text-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="label block mb-1">Namespace</label>
            <input className="input font-mono" value={namespace} onChange={(event) => setNamespace(event.target.value)} />
          </div>
          <div>
            <label className="label block mb-1">Name</label>
            <input className="input font-mono" value={name} onChange={(event) => setName(event.target.value)} />
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

function EditSkillModal({
  skill,
  onClose,
  onSaved,
}: {
  skill: SkillEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pushToast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [manifest, setManifest] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getSkillContent(skill.path)
      .then((document) => {
        setPrompt(document.prompt);
        setManifest(document.manifest);
      })
      .catch((e) => {
        const message = (e as Error).message;
        setError(message);
        pushToast({ kind: "error", title: "Could not load skill", description: message });
      })
      .finally(() => setLoading(false));
  }, [pushToast, skill.path]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveSkillContent(skill.path, prompt, manifest);
      onSaved();
      onClose();
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not save skill", description: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 overlay-scrim flex items-center justify-center p-6">
      <div className="panel w-full max-w-5xl flex flex-col" style={{ maxHeight: "85vh" }}>
        <div className="px-4 py-3 border-b border-ink-700 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{skill.id}</div>
            <div className="text-[11px] text-ink-400 font-mono mt-1">{skill.path}</div>
          </div>
          <button className="text-ink-400 hover:text-ink-100 text-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="p-4 flex-1 overflow-auto grid grid-cols-1 lg:grid-cols-2 gap-4">
          {loading ? (
            <div className="text-sm text-ink-400">Loading skill…</div>
          ) : (
            <>
              <div className="min-h-0 flex flex-col">
                <label className="label block mb-1">prompt.md</label>
                <textarea
                  className="input flex-1 min-h-[320px] font-mono text-xs"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </div>
              <div className="min-h-0 flex flex-col">
                <label className="label block mb-1">skill.yaml</label>
                <textarea
                  className="input flex-1 min-h-[320px] font-mono text-xs"
                  value={manifest}
                  onChange={(event) => setManifest(event.target.value)}
                />
              </div>
            </>
          )}
          {error && <div className="text-red-400 text-xs col-span-full">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-ink-700 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-accent" disabled={busy || loading} onClick={save}>
            {busy ? "Saving..." : "Save skill"}
          </button>
        </div>
      </div>
    </div>
  );
}
