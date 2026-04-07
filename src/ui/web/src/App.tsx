import { useEffect, useState } from "react";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/ToastProvider";
import { Pipelines } from "./views/Pipelines";
import { PipelineEditor } from "./views/PipelineEditor";
import { Projects } from "./views/Projects";
import { ProjectDetail } from "./views/ProjectDetail";
import { Runs } from "./views/Runs";
import { RunDetail } from "./views/RunDetail";
import { Providers } from "./views/Providers";
import { Skills } from "./views/Skills";

type Route =
  | { name: "pipelines" }
  | { name: "pipelineEditor"; id: string }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "runs" }
  | { name: "run"; id: string }
  | { name: "providers" }
  | { name: "skills" };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (!h || h === "pipelines") return { name: "pipelines" };
  if (h.startsWith("pipelines/")) return { name: "pipelineEditor", id: h.slice("pipelines/".length) };
  if (h === "projects") return { name: "projects" };
  if (h.startsWith("projects/")) return { name: "project", id: h.slice("projects/".length) };
  if (h === "runs") return { name: "runs" };
  if (h.startsWith("runs/")) return { name: "run", id: h.slice("runs/".length) };
  if (h === "providers") return { name: "providers" };
  if (h === "skills") return { name: "skills" };
  return { name: "pipelines" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash());

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <ToastProvider>
      <Layout active={route.name === "pipelineEditor" ? "pipelines" : route.name}>
        {route.name === "pipelines" && <Pipelines />}
        {route.name === "pipelineEditor" && <PipelineEditor pipelineId={route.id} />}
        {route.name === "projects" && <Projects />}
        {route.name === "project" && <ProjectDetail projectId={route.id} />}
        {route.name === "runs" && <Runs />}
        {route.name === "run" && <RunDetail runId={route.id} />}
        {route.name === "providers" && <Providers />}
        {route.name === "skills" && <Skills />}
      </Layout>
    </ToastProvider>
  );
}
