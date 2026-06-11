import { useCallback, useEffect, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/ToastProvider";
import { ContextStore } from "./views/ContextStore";
import { Dashboard } from "./views/Dashboard";
import { Files } from "./views/Files";
import { History } from "./views/History";
import { Logs } from "./views/Logs";
import { RunPipeline } from "./views/RunPipeline";
import { Settings } from "./views/Settings";
import { Pipelines } from "./views/Pipelines";
import { PipelineEditor } from "./views/PipelineEditor";
import { Projects } from "./views/Projects";
import { ProjectDetail } from "./views/ProjectDetail";

import { RunDetail } from "./views/RunDetail";
import { Providers } from "./views/Providers";
import { Skills } from "./views/Skills";

type Route =
  | { name: "dashboard" }
  | { name: "run"; runId?: string }
  | { name: "pipelines" }
  | { name: "pipelineEditor"; id: string }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "runs" }
  | { name: "runDetail"; id: string; from?: string }
  | { name: "providers" }
  | { name: "skills" }
  | { name: "context" }
  | { name: "files" }
  | { name: "logs" }
  | { name: "settings" };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (!h || h === "dashboard") return { name: "dashboard" };
  if (h === "run" || h.startsWith("run?")) {
    const [, query = ""] = h.split("?");
    const runId = new URLSearchParams(query).get("runId") ?? undefined;
    return { name: "run", runId };
  }
  if (h === "pipelines") return { name: "pipelines" };
  if (h.startsWith("pipelines/"))
    return { name: "pipelineEditor", id: h.slice("pipelines/".length) };
  if (h === "projects") return { name: "projects" };
  if (h.startsWith("projects/"))
    return { name: "project", id: h.slice("projects/".length) };
  if (h === "runs") return { name: "runs" };
  if (h.startsWith("runs/")) {
    const raw = h.slice("runs/".length);
    const [id, query = ""] = raw.split("?");
    const from = new URLSearchParams(query).get("from") ?? undefined;
    return { name: "runDetail", id, from };
  }
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
  if (route.name === "runDetail" && route.from === "run") return "run";
  if (route.name === "runDetail" && route.from === "logs") return "logs";
  if (route.name === "runDetail") return "history";
  if (route.name === "runs") return "history";
  return route.name;
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
        {route.name === "run" && <RunPipeline initialRunId={route.runId} />}
        {route.name === "pipelines" && <Pipelines />}
        {route.name === "pipelineEditor" && (
          <PipelineEditor pipelineId={route.id} />
        )}
        {route.name === "projects" && <Projects />}
        {route.name === "project" && <ProjectDetail projectId={route.id} />}
        {route.name === "runs" && <History />}
        {route.name === "runDetail" && <RunDetail runId={route.id} from={route.from} />}
        {route.name === "providers" && <Providers />}
        {route.name === "skills" && <Skills />}
        {route.name === "context" && <ContextStore />}
        {route.name === "files" && <Files />}
        {route.name === "logs" && <Logs />}
        {route.name === "settings" && <Settings />}
      </Layout>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </ToastProvider>
  );
}
