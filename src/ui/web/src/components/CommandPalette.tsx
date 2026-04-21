import { useEffect, useRef, useState } from "react";
import { Icons } from "./Icons";

type PaletteItem = {
  cat: string;
  id: string;
  label: string;
  icon: React.ReactNode;
  kbd?: string;
  meta?: string;
};

const ITEMS: PaletteItem[] = [
  { cat: "Actions", id: "run", label: "Run pipeline", kbd: "⇧⌘R", icon: Icons.play },
  { cat: "Actions", id: "new-pipe", label: "Create new pipeline", kbd: "⌘N", icon: Icons.plus },
  { cat: "Go to", id: "dashboard", label: "Dashboard", icon: Icons.home },
  { cat: "Go to", id: "pipelines", label: "Pipelines", icon: Icons.flow },
  { cat: "Go to", id: "providers", label: "Providers", icon: Icons.plug },
  { cat: "Go to", id: "history", label: "History", icon: Icons.clock },
  { cat: "Go to", id: "context", label: "Context store", icon: Icons.db },
  { cat: "Go to", id: "files", label: "Workspace files", icon: Icons.folder },
  { cat: "Go to", id: "skills", label: "Skills", icon: Icons.skill },
  { cat: "Go to", id: "logs", label: "Logs", icon: Icons.terminal },
  { cat: "Go to", id: "settings", label: "Settings", icon: Icons.settings },
];

const NAV_IDS = new Set([
  "dashboard", "pipelines", "providers", "history", "context",
  "skills", "logs", "settings", "run", "files",
]);

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
};

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  if (!open) return null;

  const filtered = query
    ? ITEMS.filter((i) =>
        i.label.toLowerCase().includes(query.toLowerCase()),
      )
    : ITEMS;

  const groups: Record<string, PaletteItem[]> = {};
  for (const item of filtered) {
    (groups[item.cat] ??= []).push(item);
  }
  const groupKeys = Object.keys(groups);

  function handleSelect(item: PaletteItem) {
    if (NAV_IDS.has(item.id)) {
      window.location.hash = `#/${item.id === "history" ? "runs" : item.id}`;
    } else if (item.id === "new-pipe") {
      window.location.hash = "#/pipelines";
    } else if (item.id.startsWith("p")) {
      window.location.hash = "#/pipelines";
    }
    onClose();
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.35)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "15vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}
      >
        {/* Search input */}
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ color: "var(--fg-dim)" }}>{Icons.search}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actions, pipelines, screens..."
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 14,
              color: "var(--fg)",
              fontFamily: "inherit",
            }}
          />
          <span
            className="mono"
            style={{
              fontSize: 10.5,
              padding: "1px 5px",
              background: "var(--bg-soft)",
              border: "1px solid var(--border)",
              borderRadius: 3,
              color: "var(--fg-dim)",
            }}
          >
            ESC
          </span>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
          {groupKeys.map((g) => (
            <div key={g}>
              <div
                style={{
                  padding: "8px 10px 4px",
                  fontSize: 10.5,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  color: "var(--fg-dim)",
                  fontWeight: 600,
                }}
              >
                {g}
              </div>
              {groups[g].map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    background:
                      i === 0 && g === groupKeys[0]
                        ? "var(--bg-soft)"
                        : "transparent",
                    border: "none",
                    borderRadius: "var(--r-sm)",
                    cursor: "pointer",
                    fontSize: 13,
                    color: "var(--fg)",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      "var(--bg-soft)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      "transparent";
                  }}
                >
                  <span style={{ color: "var(--fg-dim)" }}>{item.icon}</span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.meta && (
                    <span
                      style={{ fontSize: 11.5, color: "var(--fg-muted)" }}
                    >
                      {item.meta}
                    </span>
                  )}
                  {item.kbd && (
                    <span
                      className="mono"
                      style={{
                        fontSize: 10.5,
                        padding: "1px 5px",
                        background: "var(--bg-soft)",
                        border: "1px solid var(--border)",
                        borderRadius: 3,
                        color: "var(--fg-dim)",
                      }}
                    >
                      {item.kbd}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                color: "var(--fg-muted)",
                fontSize: 13,
              }}
            >
              No results
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
