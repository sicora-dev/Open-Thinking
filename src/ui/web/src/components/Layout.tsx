import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
	THEME_STORAGE_KEY,
	applyTheme,
	resolveInitialTheme,
	type UiTheme,
} from "../lib/theme";

type NavItem = { id: string; label: string; href: string; icon: string };
type SectionMeta = { title: string; subtitle: string };

const NAV: NavItem[] = [
	{ id: "pipelines", label: "Pipelines", href: "#/pipelines", icon: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" },
	{ id: "projects", label: "Projects", href: "#/projects", icon: "M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" },
	{ id: "runs", label: "Runs", href: "#/runs", icon: "M13 2.05v3.03c3.39.49 6 3.39 6 6.92 0 .9-.18 1.75-.5 2.54l2.63 1.53c.56-1.24.87-2.6.87-4.07 0-5.29-3.87-9.18-9-9.65zM12 19c-3.87 0-7-3.13-7-7 0-3.53 2.61-6.43 6-6.92V2.05c-5.13.47-9 4.36-9 9.65 0 5.29 3.87 9.18 9 9.65v-3.03c-3.39-.49-6-3.39-6-6.92 0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7v3.03c5.13-.47 9-4.36 9-9.65 0-5.29-3.87-9.18-9-9.65z" },
	{ id: "providers", label: "Providers", href: "#/providers", icon: "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" },
	{ id: "skills", label: "Skills", href: "#/skills", icon: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84a.484.484 0 0 0-.48.41l-.36 2.54c-.59.24-1.12.56-1.62.94l-2.39-.96a.488.488 0 0 0-.59.22L3.16 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .43-.17.48-.41l.36-2.54c.59-.24 1.12-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" },
];

const SECTION_META: Record<string, SectionMeta> = {
	pipelines: {
		title: "Pipelines",
		subtitle: "Design and manage your AI workflows",
	},
	projects: {
		title: "Projects",
		subtitle: "Organize your work into projects",
	},
	runs: {
		title: "Runs",
		subtitle: "Monitor executions and view history",
	},
	run: {
		title: "Live Run",
		subtitle: "Real-time execution details",
	},
	providers: {
		title: "Providers",
		subtitle: "Configure LLM providers and API keys",
	},
	skills: {
		title: "Skills",
		subtitle: "Manage reusable AI skills",
	},
};

const SIDEBAR_WIDTH = "w-56";
const SIDEBAR_COLLAPSED_WIDTH = "w-14";

export function Layout({ active, children }: { active: string; children: ReactNode }) {
	const [version, setVersion] = useState<string | null>(null);
	const [theme, setTheme] = useState<UiTheme>(resolveInitialTheme);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
		// Persist sidebar state
		if (typeof window !== "undefined") {
			return localStorage.getItem("sidebar-collapsed") === "true";
		}
		return false;
	});
	const section = SECTION_META[active] ?? SECTION_META.pipelines;

	useEffect(() => {
		api.health().then((h) => setVersion(h.version)).catch(() => {});
	}, []);

	useEffect(() => {
		applyTheme(theme);
		window.localStorage.setItem(THEME_STORAGE_KEY, theme);
	}, [theme]);

	useEffect(() => {
		localStorage.setItem("sidebar-collapsed", String(sidebarCollapsed));
	}, [sidebarCollapsed]);

	const isActive = (id: string) =>
		active === id ||
		(id === "runs" && active === "run") ||
		(id === "projects" && active === "project");

	const toggleSidebar = () => setSidebarCollapsed((prev) => !prev);

	return (
		<div className="h-full flex">
			{/* Sidebar */}
			<aside
				className={`${sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH} shrink-0 border-r border-ink-700/50 bg-ink-900/95 flex flex-col backdrop-blur-sm transition-all duration-300 ease-out`}
			>
				{/* Logo area */}
				<div className={`${sidebarCollapsed ? "px-2 py-4" : "px-4 py-4"} border-b border-ink-700/50 transition-all duration-300`}>
					<div className="flex items-center gap-3">
						<div className="relative flex-shrink-0">
							<div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-accent-dim flex items-center justify-center shadow-lg shadow-accent/20">
								<svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
									<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
								</svg>
							</div>
							{sidebarCollapsed && (
								<div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-ink-900" />
							)}
						</div>
						{!sidebarCollapsed && (
							<div className="min-w-0 overflow-hidden">
								<span className="font-semibold text-ink-100 tracking-tight block">OpenThinking</span>
								<span className="text-[10px] text-ink-400 font-mono">v{version ?? "—"}</span>
							</div>
							)}
					</div>
				</div>

				{/* Navigation */}
				<nav className="flex-1 py-3 px-2">
					{NAV.map((item) => (
						<a
							key={item.id}
							href={item.href}
							title={sidebarCollapsed ? item.label : undefined}
							className={`
								flex items-center gap-3 px-2.5 py-2.5 text-sm rounded-lg transition-all duration-200 group
								${isActive(item.id)
									? "bg-accent/10 text-accent border-l-2 border-accent"
									: "text-ink-400 hover:text-ink-100 hover:bg-ink-800/60 border-l-2 border-transparent"
								}
								${sidebarCollapsed ? "justify-center" : ""}
							`}
						>
							<svg
								className={`w-5 h-5 flex-shrink-0 transition-transform duration-200 ${isActive(item.id) ? "text-accent" : "group-hover:scale-110"}`}
								viewBox="0 0 24 24"
								fill="currentColor"
							>
								<path d={item.icon} />
							</svg>
							{!sidebarCollapsed && (
								<span className="font-medium">{item.label}</span>
							)}
						</a>
					))}
				</nav>

				{/* Footer / Toggle */}
				<div className="p-2 border-t border-ink-700/50">
					<button
						onClick={toggleSidebar}
						type="button"
						title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
						className={`
							w-full flex items-center gap-2 px-2.5 py-2 text-xs text-ink-400 hover:text-ink-200
							hover:bg-ink-800/50 rounded-lg transition-all duration-200
							${sidebarCollapsed ? "justify-center" : ""}
						`}
					>
						<svg
							className={`w-4 h-4 transition-transform duration-300 ${sidebarCollapsed ? "" : "rotate-180"}`}
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round"/>
						</svg>
						{!sidebarCollapsed && <span>Collapse</span>}
					</button>
				</div>
			</aside>

			{/* Main */}
			<main className="flex-1 min-w-0 flex flex-col bg-ink-950 relative">
				{/* Header - Glass effect */}
				<header className="h-14 shrink-0 border-b border-ink-700/50 bg-ink-900/70 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-40">
					<div className="min-w-0 flex items-center gap-4">
						<div>
							<h1 className="text-sm font-semibold text-ink-100">{section.title}</h1>
							<p className="text-[11px] text-ink-400 truncate">{section.subtitle}</p>
						</div>
					</div>
					<div className="flex items-center gap-3">
						<button
							className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-ink-300 hover:text-ink-100 bg-ink-800/50 hover:bg-ink-700/50 border border-ink-600/50 rounded-lg transition-all duration-200"
							onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
							type="button"
						>
							{theme === "dark" ? (
								<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
									<circle cx="12" cy="12" r="5" />
									<line x1="12" y1="1" x2="12" y2="3" />
									<line x1="12" y1="21" x2="12" y2="23" />
									<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
									<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
									<line x1="1" y1="12" x2="3" y2="12" />
									<line x1="21" y1="12" x2="23" y2="12" />
									<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
									<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
								</svg>
							) : (
								<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
									<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
								</svg>
								)}
							<span className="hidden sm:inline">{theme === "dark" ? "Light" : "Dark"}</span>
						</button>
						<div className="hidden sm:flex items-center gap-2 text-[11px] text-ink-400 font-mono bg-ink-800/50 px-2 py-1 rounded-md border border-ink-700/50">
							<span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
							127.0.0.1
						</div>
					</div>
				</header>
				<div className="flex-1 overflow-auto">{children}</div>
			</main>
		</div>
	);
}
