import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  resolveInitialTheme,
  type UiTheme,
} from "../lib/theme";

type NavItem = { id: string; label: string; href: string };
type SectionMeta = { title: string; subtitle: string };

const NAV: NavItem[] = [
  { id: "pipelines", label: "Pipelines", href: "#/pipelines" },
  { id: "projects", label: "Projects", href: "#/projects" },
  { id: "runs", label: "Runs", href: "#/runs" },
  { id: "providers", label: "Providers", href: "#/providers" },
  { id: "skills", label: "Skills", href: "#/skills" },
];

const SECTION_META: Record<string, SectionMeta> = {
  pipelines: {
    title: "Pipelines",
    subtitle: "Manage global pipelines stored under ~/.openthk/pipelines.",
  },
  projects: {
    title: "Projects",
    subtitle: "Register project roots and manage their local pipelines and skills.",
  },
  runs: {
    title: "Runs",
    subtitle: "Inspect live execution, replay history, and cancel active work.",
  },
  run: {
    title: "Live Run",
    subtitle: "Per-stage activity, status, and event stream for the selected run.",
  },
  providers: {
    title: "Providers",
    subtitle: "Manage catalog visibility and global API key configuration.",
  },
  skills: {
    title: "Skills",
    subtitle: "Manage global skills stored under ~/.openthk/skills.",
  },
};

export function Layout({ active, children }: { active: string; children: ReactNode }) {
  const [version, setVersion] = useState<string | null>(null);
  const [theme, setTheme] = useState<UiTheme>(resolveInitialTheme);
  const section = SECTION_META[active] ?? SECTION_META.pipelines;

  useEffect(() => {
    api.health().then((h) => setVersion(h.version)).catch(() => {});
  }, []);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const isActive = (id: string) =>
    active === id ||
    (id === "runs" && active === "run") ||
    (id === "projects" && active === "project");

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-ink-700 bg-ink-900 flex flex-col">
        <div className="px-4 py-4 border-b border-ink-700">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-accent" />
            <span className="font-medium tracking-tight">OpenThinking</span>
          </div>
          <div className="text-[11px] text-ink-400 mt-1">
            v{version ?? "—"}
          </div>
        </div>
        <nav className="flex-1 p-2">
          {NAV.map((item) => (
            <a
              key={item.id}
              href={item.href}
              className={`block px-3 py-1.5 text-sm border-l-2 ${
                isActive(item.id)
                  ? "border-accent text-ink-100 bg-ink-800"
                  : "border-transparent text-ink-300 hover:text-ink-100 hover:bg-ink-800"
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="p-3 border-t border-ink-700 text-[11px] text-ink-400">
          Local UI · 127.0.0.1
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col bg-ink-950">
        <header className="h-14 shrink-0 border-b border-ink-700 bg-ink-900/80 px-6 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium">{section.title}</div>
            <div className="text-[11px] text-ink-400 truncate">{section.subtitle}</div>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="btn !px-2.5 !py-1 text-xs"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              type="button"
            >
              {theme === "dark" ? "Light UI" : "Dark UI"}
            </button>
            <div className="text-[11px] text-ink-400 font-mono flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-accent animate-pulse" />
              127.0.0.1
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}
