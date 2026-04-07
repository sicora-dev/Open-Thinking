import { useEffect, useRef, useState } from "react";
import { api, type FsEntry } from "../lib/api";

/**
 * Minimal directory browser. Lets the user navigate folders and either:
 *   - Pick a directory (when mode = "dir")
 *   - Pick an existing YAML file (when mode = "yaml")
 */
export function PathPicker({
  mode,
  onPick,
  onClose,
  initialPath,
}: {
  mode: "dir" | "yaml";
  onPick: (path: string) => void;
  onClose: () => void;
  initialPath?: string;
}) {
  const [cwd, setCwd] = useState<string>(initialPath ?? "");
  const [parent, setParent] = useState<string>("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(mode === "yaml");
  const initializedRef = useRef(false);

  const load = async (path?: string) => {
    setError(null);
    try {
      const r = await api.browse(path, { showHidden });
      setCwd(r.path);
      setParent(r.parent);
      setEntries(r.entries);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    const targetPath = initializedRef.current ? cwd || initialPath : initialPath;
    load(targetPath).finally(() => {
      initializedRef.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  return (
    <div className="fixed inset-0 z-50 overlay-scrim flex items-center justify-center p-6">
      <div className="panel w-full max-w-2xl flex flex-col" style={{ maxHeight: "80vh" }}>
        <div className="px-4 py-3 border-b border-ink-700 flex items-center justify-between">
          <div className="text-sm font-medium">
            {mode === "dir" ? "Select folder" : "Select pipeline file"}
          </div>
          <button className="text-ink-400 hover:text-ink-100 text-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="px-4 py-2 border-b border-ink-700 flex items-center gap-2 text-xs">
          <button className="btn !py-1" onClick={() => load(parent)}>
            ↑
          </button>
          <code className="text-ink-300 truncate">{cwd}</code>
          <label className="ml-auto flex items-center gap-2 text-ink-400">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => setShowHidden(event.target.checked)}
            />
            <span>Show hidden</span>
          </label>
        </div>

        <div className="overflow-auto flex-1">
          {error && <div className="p-4 text-red-400 text-sm">{error}</div>}
          <ul className="text-sm">
            {entries.map((e) => {
              const selectable =
                (mode === "dir" && e.isDir) || (mode === "yaml" && e.isYaml);
              return (
                <li
                  key={e.path}
                  className={`px-4 py-1.5 row-hover flex items-center gap-2 ${
                    !e.isDir && !e.isYaml && mode === "yaml" ? "opacity-40" : ""
                  }`}
                  onClick={() => {
                    if (e.isDir) load(e.path);
                    else if (selectable) onPick(e.path);
                  }}
                  onDoubleClick={() => {
                    if (selectable && mode === "dir") onPick(e.path);
                  }}
                >
                  <span className="w-4 text-ink-400">{e.isDir ? "▸" : e.isYaml ? "≡" : "·"}</span>
                  <span className={e.isDir ? "text-accent" : ""}>{e.name}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="px-4 py-3 border-t border-ink-700 flex items-center justify-between gap-2">
          <div className="text-[11px] text-ink-400">
            {mode === "dir"
              ? "Click ↑ to go up, double-click a folder to choose it"
              : "Click a .yaml file to select it"}
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            {mode === "dir" && (
              <button className="btn-accent" onClick={() => onPick(cwd)}>
                Use this folder
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
