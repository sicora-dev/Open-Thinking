import { useCallback, useEffect, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/ToastProvider";
import { Dashboard } from "./views/Dashboard";
import { Pipelines } from "./views/Pipelines";
import { PipelineEditor } from "./views/PipelineEditor";
import { Projects } from "./views/Projects";
import { ProjectDetail } from "./views/ProjectDetail";
import { Runs } from "./views/Runs";
import { RunDetail } from "./views/RunDetail";
import { Providers } from "./views/Providers";
import { Skills } from "./views/Skills";

type Route =
  | { name: "dashboard" }
  | { name: "run" }
  | { name: "pipelines" }
  | { name: "pipelineEditor"; id: string }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "runs" }
  | { name: "runDetail"; id: string }
  | { name: "providers" }
  | { name: "skills" }
  | { name: "context" }
  | { name: "files" }
  | { name: "logs" }
  | { name: "settings" };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (!h || h === "dashboard") return { name: "dashboard" };
  if (h === "run") return { name: "run" };
  if (h === "pipelines") return { name: "pipelines" };
  if (h.startsWith("pipelines/"))
    return { name: "pipelineEditor", id: h.slice("pipelines/".length) };
  if (h === "projects") return { name: "projects" };
  if (h.startsWith("projects/"))
    return { name: "project", id: h.slice("projects/".length) };
  if (h === "runs") return { name: "runs" };
  if (h.startsWith("runs/"))
    return { name: "runDetail", id: h.slice("runs/".length) };
  if (h === "providers") return { name: "providers" };
  if (h === "skills") return { name: "skills" };
  if (h === "context") return { name: "context" };
  if (h === "files") return { name: "files" };
  if (h === "logs") return { name: "logs" };
  if (h === "settings") return { name: "settings" };
  return { name: "dashboard" };
}

function routeToActive(route: Route): string {
  if (route.name === "pipelineEditor") return "pipelines";
  if (route.name === "runDetail") return "history";
  if (route.name === "runs") return "history";
  return route.name;
}

function PlaceholderView({ title }: { title: string }) {
  return (
    <div
      style={{
        padding: "48px 28px",
        maxWidth: 600,
        margin: "0 auto",
        textAlign: "center",
      }}
    >
      <h2
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "var(--fg)",
          marginBottom: 8,
        }}
      >
        {title}
      </h2>
      <p style={{ fontSize: 14, color: "var(--fg-muted)" }}>
        This view is coming soon.
      </p>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash());
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === "Escape") setPaletteOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.key === "r" && e.shiftKey) {
        e.preventDefault();
        window.location.hash = "#/run";
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleOpenPalette = useCallback(() => setPaletteOpen(true), []);

  const active = routeToActive(route);

  return (
    <ToastProvider>
      <Layout active={active} onOpenPalette={handleOpenPalette}>
        {route.name === "dashboard" && <Dashboard />}
        {route.name === "run" && <PlaceholderView title="Run Pipeline" />}
        {route.name === "pipelines" && <Pipelines />}
        {route.name === "pipelineEditor" && (
          <PipelineEditor pipelineId={route.id} />
        )}
        {route.name === "projects" && <Projects />}
        {route.name === "project" && <ProjectDetail projectId={route.id} />}
        {route.name === "runs" && <Runs />}
        {route.name === "runDetail" && <RunDetail runId={route.id} />}
        {route.name === "providers" && <Providers />}
        {route.name === "skills" && <Skills />}
        {route.name === "context" && <PlaceholderView title="Context Store" />}
        {route.name === "files" && <PlaceholderView title="Workspace Files" />}
        {route.name === "logs" && <PlaceholderView title="Logs" />}
        {route.name === "settings" && <PlaceholderView title="Settings" />}
      </Layout>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </ToastProvider>
  );
}
