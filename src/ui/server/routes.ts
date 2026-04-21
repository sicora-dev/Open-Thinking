/**
 * HTTP routing for the UI server.
 *
 * Phase B endpoints:
 *   GET    /api/health
 *   GET    /api/projects                        — list registered projects
 *   POST   /api/projects                        — register a project directory
 *   DELETE /api/projects/:id                    — unregister a project
 *   GET    /api/projects/:id/pipelines          — list project pipelines
 *   POST   /api/projects/:id/pipelines          — create a project pipeline
 *   GET    /api/pipelines                       — list global pipelines
 *   GET    /api/pipelines/:id                   — load + parse a pipeline
 *   POST   /api/pipelines                       — register an existing YAML or save new global content
 *   POST   /api/pipelines/validate              — validate draft YAML content
 *   PUT    /api/pipelines/:id                   — overwrite YAML
 *   DELETE /api/pipelines/:id                   — delete managed pipeline files or unregister legacy ones
 *   POST   /api/pipelines/:id/validate          — parse + validate
 *   POST   /api/pipelines/:id/run               — kick off a run, returns runId
 *   GET    /api/runs                            — list runs
 *   GET    /api/runs/:id                        — single run + summary
 *   GET    /api/runs/:id/stream                 — SSE event stream
 *   POST   /api/runs/:id/cancel                 — abort
 *   GET    /api/context                         — inspect project context stores
 *   GET    /api/providers                       — catalog + key status
 *   POST   /api/providers                       — add/update API key
 *   DELETE /api/providers/:id                   — remove key
 *   GET    /api/settings                        — read UI config
 *   PUT    /api/settings                        — update UI config
 *   GET    /api/skills                          — list global or project skills
 *   POST   /api/skills                          — create a global or project skill
 *   GET    /api/skills/content                  — load a skill prompt + manifest
 *   PUT    /api/skills/content                  — save a skill prompt + manifest
 *   DELETE /api/skills/content                  — delete a skill folder
 *   GET    /api/fs/browse                       — directory listing for path picker
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  PROVIDER_CATALOG,
  addProvider,
  listProviders,
  loadOpenthkConfig,
  removeProvider as removeGlobalProvider,
  saveOpenthkConfig,
} from "../../config";
import { getOpenthkConfigDir } from "../../config/paths";
import { createContextStore } from "../../context/store";
import { parsePipeline, parsePipelineFromString } from "../../pipeline/parser";
import { getProjectDir, initProjectWorkspace, pipelineNameFromFilename } from "../../workspace";
import {
  type PipelineIndexEntry,
  getIndexedPipeline,
  listIndexedPipelines,
  registerPipeline,
  touchPipeline,
  unregisterPipeline,
} from "./pipelines-index";
import {
  type ProjectIndexEntry,
  getIndexedProject,
  listIndexedProjects,
  registerProject,
  unregisterProject,
} from "./projects-index";
import {
  type RunStatus,
  getRun,
  getRunEvents,
  listRuns,
} from "./runs-store";
import { startRun, cancelRun, subscribeRun, isRunActive } from "./run-manager";
import {
  createSkillInRoot,
  deleteSkillDocument,
  getGlobalSkillsDir,
  getProjectSkillsDir,
  listSkillsInRoot,
  readSkillDocument,
  saveSkillDocument,
  type SkillEntry,
} from "./skills-store";
import { VERSION } from "../../version";

const startedAt = new Date().toISOString();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function badRequest(message: string): Response {
  return json({ ok: false, error: message }, 400);
}

function notFound(message = "Not found"): Response {
  return json({ ok: false, error: message }, 404);
}

function serverError(message: string): Response {
  return json({ ok: false, error: message }, 500);
}

async function readJsonBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/** Pattern matching for routes like /api/pipelines/:id */
function match(pathname: string, pattern: string): Record<string, string> | null {
  const a = pathname.split("/").filter(Boolean);
  const b = pattern.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const partA = a[i] as string;
    const partB = b[i] as string;
    if (partB.startsWith(":")) {
      params[partB.slice(1)] = decodeURIComponent(partA);
    } else if (partA !== partB) {
      return null;
    }
  }
  return params;
}

function getGlobalPipelinesDir(): string {
  return join(getOpenthkConfigDir(), "pipelines");
}

function getProjectPipelinesDir(projectPath: string): string {
  return join(projectPath, ".openthk", "pipelines");
}

function normalizePipelineFileName(name: string): string {
  const normalized = name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = normalized || "new-pipeline";
  return base.endsWith(".yaml") || base.endsWith(".yml")
    ? base
    : `${base}.pipeline.yaml`;
}

function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
  const rel = relative(resolve(rootPath), resolve(targetPath));
  return rel === "" || (!rel.startsWith("..") && rel !== "..");
}

function syncPipelineDirectory(input: {
  dir: string;
  scope: "global" | "project";
  projectId?: string | null;
  rootPath: string;
}): PipelineIndexEntry[] {
  mkdirSync(input.dir, { recursive: true });
  const files = readdirSync(input.dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const entries: PipelineIndexEntry[] = [];
  for (const file of files) {
    const path = join(input.dir, file);
    const registered = registerPipeline({
      path,
      name: pipelineNameFromFilename(file),
      scope: input.scope,
      projectId: input.projectId ?? null,
      rootPath: input.rootPath,
    });
    if (registered.ok) entries.push(registered.value);
  }
  return entries;
}

function listGlobalPipelinesForUi(): PipelineIndexEntry[] {
  const pipelinesDir = getGlobalPipelinesDir();
  syncPipelineDirectory({
    dir: pipelinesDir,
    scope: "global",
    rootPath: getOpenthkConfigDir(),
  });
  return listIndexedPipelines({ scope: "global" }).filter((entry) =>
    isPathWithinRoot(entry.path, pipelinesDir),
  );
}

function listProjectPipelinesForUi(project: ProjectIndexEntry): PipelineIndexEntry[] {
  initProjectWorkspace(project.path);
  const pipelinesDir = getProjectPipelinesDir(project.path);
  syncPipelineDirectory({
    dir: pipelinesDir,
    scope: "project",
    projectId: project.id,
    rootPath: project.path,
  });
  return listIndexedPipelines({ scope: "project", projectId: project.id }).filter((entry) =>
    isPathWithinRoot(entry.path, pipelinesDir),
  );
}

function listGlobalSkillsForUi(): SkillEntry[] {
  mkdirSync(getGlobalSkillsDir(), { recursive: true });
  return listSkillsInRoot(getGlobalSkillsDir(), "global");
}

function listProjectSkillsForUi(project: ProjectIndexEntry): SkillEntry[] {
  mkdirSync(getProjectSkillsDir(project.path), { recursive: true });
  return listSkillsInRoot(getProjectSkillsDir(project.path), "project", project.id);
}

function buildProjectSummary(project: ProjectIndexEntry) {
  initProjectWorkspace(project.path);
  return {
    ...project,
    pipelinesCount: listProjectPipelinesForUi(project).length,
    skillsCount: listProjectSkillsForUi(project).length,
  };
}

export async function handleRequest(req: Request, port: number): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  // ── Health ─────────────────────────────────────────────
  if (method === "GET" && pathname === "/api/health") {
    return json({ ok: true, version: VERSION, port, startedAt });
  }

  // ── Projects ───────────────────────────────────────────
  if (method === "GET" && pathname === "/api/projects") {
    return json({
      ok: true,
      projects: listIndexedProjects().map((project) => buildProjectSummary(project)),
    });
  }

  if (method === "POST" && pathname === "/api/projects") {
    const body = await readJsonBody<{ path: string; name?: string }>(req);
    if (!body?.path) return badRequest("`path` is required");

    const abs = resolve(body.path);
    if (!isAbsolute(abs)) return badRequest("path must be absolute");
    if (!existsSync(abs)) return badRequest(`Directory does not exist: ${abs}`);
    if (!statSync(abs).isDirectory()) return badRequest(`Path is not a directory: ${abs}`);

    initProjectWorkspace(abs);
    const result = registerProject({ path: abs, name: body.name });
    if (!result.ok) return serverError(result.error.message);
    return json({ ok: true, project: buildProjectSummary(result.value) }, 201);
  }

  const projectParams = match(pathname, "/api/projects/:id");
  const projectPipelinesParams = match(pathname, "/api/projects/:id/pipelines");
  const projectSkillsParams = match(pathname, "/api/projects/:id/skills");

  if (projectParams && method === "DELETE") {
    const project = getIndexedProject(projectParams.id ?? "");
    if (!project) return notFound("Project not registered");
    const removed = unregisterProject(project.id);
    return json({ ok: true, removed });
  }

  if (projectPipelinesParams && method === "GET") {
    const project = getIndexedProject(projectPipelinesParams.id ?? "");
    if (!project) return notFound("Project not registered");
    return json({ ok: true, pipelines: listProjectPipelinesForUi(project) });
  }

  if (projectPipelinesParams && method === "POST") {
    const project = getIndexedProject(projectPipelinesParams.id ?? "");
    if (!project) return notFound("Project not registered");
    const body = await readJsonBody<{
      name?: string;
      fileName?: string;
      content?: string;
      overwrite?: boolean;
      path?: string;
    }>(req);
    if (!body) return badRequest("Invalid request body");

    initProjectWorkspace(project.path);
    const pipelinesDir = getProjectPipelinesDir(project.path);

    const abs = body.path
      ? resolve(body.path)
      : join(
          pipelinesDir,
          normalizePipelineFileName(body.fileName ?? body.name ?? "new-pipeline"),
        );

    if (!isPathWithinRoot(abs, pipelinesDir)) {
      return badRequest(`Project pipelines must live inside ${pipelinesDir}`);
    }

    if (body.content === undefined) return badRequest("`content` is required");
    if (existsSync(abs) && !body.overwrite) {
      return badRequest(`File already exists: ${abs}. Pass overwrite=true to replace.`);
    }

    try {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body.content, "utf-8");
    } catch (e) {
      return serverError(`Failed to write file: ${(e as Error).message}`);
    }

    const result = registerPipeline({
      path: abs,
      name: body.name?.trim() || pipelineNameFromFilename(abs),
      scope: "project",
      projectId: project.id,
      rootPath: project.path,
    });
    if (!result.ok) return serverError(result.error.message);
    return json({ ok: true, pipeline: result.value }, 201);
  }

  if (projectSkillsParams && method === "GET") {
    const project = getIndexedProject(projectSkillsParams.id ?? "");
    if (!project) return notFound("Project not registered");
    return json({ ok: true, skills: listProjectSkillsForUi(project) });
  }

  // ── Pipelines ──────────────────────────────────────────
  if (method === "GET" && pathname === "/api/pipelines") {
    return json({ ok: true, pipelines: listGlobalPipelinesForUi() });
  }

  if (method === "POST" && pathname === "/api/pipelines") {
    const body = await readJsonBody<{
      path?: string;
      name?: string;
      fileName?: string;
      content?: string;
      overwrite?: boolean;
    }>(req);
    if (!body) return badRequest("Invalid request body");

    const pipelinesDir = getGlobalPipelinesDir();
    const abs = body.path
      ? resolve(body.path)
      : join(
          pipelinesDir,
          normalizePipelineFileName(body.fileName ?? body.name ?? "new-pipeline"),
        );
    if (!isAbsolute(abs)) return badRequest("path must be absolute");
    if (!isPathWithinRoot(abs, pipelinesDir)) {
      return badRequest(`Global pipelines must live inside ${pipelinesDir}`);
    }

    if (typeof body.content === "string") {
      if (existsSync(abs) && !body.overwrite) {
        return badRequest(`File already exists: ${abs}. Pass overwrite=true to replace.`);
      }
      try {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, body.content, "utf-8");
      } catch (e) {
        return serverError(`Failed to write file: ${(e as Error).message}`);
      }
    } else if (!existsSync(abs)) {
      return badRequest(`File does not exist: ${abs}`);
    }

    // Try to parse to derive the name if not provided
    let name = body.name;
    if (!name) {
      const parsed = await parsePipeline(abs, false);
      name = parsed.ok ? parsed.value.name : abs;
    }

    const reg = registerPipeline({
      path: abs,
      name,
      scope: "global",
      rootPath: getOpenthkConfigDir(),
    });
    if (!reg.ok) return serverError(reg.error.message);
    return json({ ok: true, pipeline: reg.value }, 201);
  }

  if (method === "POST" && pathname === "/api/pipelines/validate") {
    const body = await readJsonBody<{ content: string }>(req);
    if (!body?.content) return badRequest("`content` is required");
    const parsed = parsePipelineFromString(body.content, false);
    if (!parsed.ok) return json({ ok: false, error: parsed.error.message }, 200);
    return json({ ok: true, config: parsed.value });
  }

  // /api/pipelines/:id and sub-routes
  const pipelineParams = match(pathname, "/api/pipelines/:id");
  const pipelineValidateParams = match(pathname, "/api/pipelines/:id/validate");
  const pipelineRunParams = match(pathname, "/api/pipelines/:id/run");

  if (pipelineParams && method === "GET") {
    const entry = getIndexedPipeline(pipelineParams.id ?? "");
    if (!entry) return notFound("Pipeline not registered");
    if (!existsSync(entry.path)) return notFound(`File missing: ${entry.path}`);
    const yamlText = readFileSync(entry.path, "utf-8");
    const parsed = await parsePipeline(entry.path, false);
    touchPipeline(entry.id);
    return json({
      ok: true,
      entry,
      yaml: yamlText,
      config: parsed.ok ? parsed.value : null,
      parseError: parsed.ok ? null : parsed.error.message,
    });
  }

  if (pipelineParams && method === "PUT") {
    const entry = getIndexedPipeline(pipelineParams.id ?? "");
    if (!entry) return notFound("Pipeline not registered");
    const body = await readJsonBody<{ content: string }>(req);
    if (!body?.content) return badRequest("`content` is required");
    // Validate before saving
    const parsed = parsePipelineFromString(body.content, false);
    if (!parsed.ok) return badRequest(`Invalid pipeline: ${parsed.error.message}`);
    try {
      writeFileSync(entry.path, body.content, "utf-8");
    } catch (e) {
      return serverError(`Failed to save: ${(e as Error).message}`);
    }
    return json({ ok: true });
  }

  if (pipelineParams && method === "DELETE") {
    const entry = getIndexedPipeline(pipelineParams.id ?? "");
    if (!entry) return notFound("Pipeline not registered");

    let deletedFile = false;
    if (entry.scope === "global" && isPathWithinRoot(entry.path, getGlobalPipelinesDir())) {
      try {
        if (existsSync(entry.path)) {
          unlinkSync(entry.path);
          deletedFile = true;
        }
      } catch (e) {
        return serverError(`Failed to delete pipeline file: ${(e as Error).message}`);
      }
    }

    if (entry.scope === "project" && entry.projectId) {
      const project = getIndexedProject(entry.projectId);
      if (project && isPathWithinRoot(entry.path, getProjectPipelinesDir(project.path))) {
        try {
          if (existsSync(entry.path)) {
            unlinkSync(entry.path);
            deletedFile = true;
          }
        } catch (e) {
          return serverError(`Failed to delete pipeline file: ${(e as Error).message}`);
        }
      }
    }

    const ok2 = unregisterPipeline(entry.id);
    if (!ok2) return notFound("Pipeline not registered");
    return json({ ok: true, deletedFile });
  }

  if (pipelineValidateParams && method === "POST") {
    const entry = getIndexedPipeline(pipelineValidateParams.id ?? "");
    if (!entry) return notFound("Pipeline not registered");
    const parsed = await parsePipeline(entry.path, false);
    if (!parsed.ok) return json({ ok: false, error: parsed.error.message }, 200);
    return json({ ok: true, config: parsed.value });
  }

  if (pipelineRunParams && method === "POST") {
    const entry = getIndexedPipeline(pipelineRunParams.id ?? "");
    if (!entry) return notFound("Pipeline not registered");
    const body = await readJsonBody<{ input: string }>(req);
    if (!body?.input) return badRequest("`input` is required");
    const result = await startRun({ entry, input: body.input });
    if (!result.ok) return badRequest(result.error.message);
    return json({ ok: true, runId: result.value.runId }, 202);
  }

  // ── Runs ───────────────────────────────────────────────
  if (method === "GET" && pathname === "/api/runs") {
    return json({ ok: true, runs: listRuns(100) });
  }

  const runParams = match(pathname, "/api/runs/:id");
  const runStreamParams = match(pathname, "/api/runs/:id/stream");
  const runCancelParams = match(pathname, "/api/runs/:id/cancel");

  if (runParams && method === "GET") {
    const run = getRun(runParams.id ?? "");
    if (!run) return notFound();
    const events = getRunEvents(run.id, 0).map((e) => ({
      seq: e.seq,
      ts: e.ts,
      type: e.type,
      payload: JSON.parse(e.payload),
    }));
    return json({
      ok: true,
      run,
      events,
      active: run.status === "running",
      cancellable: isRunActive(run.id),
    });
  }

  if (runStreamParams && method === "GET") {
    const runId = runStreamParams.id ?? "";
    const run = getRun(runId);
    if (!run) return notFound();

    // SSE
    const stream = new ReadableStream({
      start(controller) {
        let closed = false;
        let lastSeq = 0;
        let unsubscribe: (() => void) | null = null;
        let hb: ReturnType<typeof setInterval> | null = null;
        let poll: ReturnType<typeof setInterval> | null = null;

        const cleanup = () => {
          if (hb) clearInterval(hb);
          if (poll) clearInterval(poll);
          hb = null;
          poll = null;
          unsubscribe?.();
          unsubscribe = null;
        };

        const send = (type: string, data: unknown) => {
          if (closed) return;
          controller.enqueue(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        const closeStream = () => {
          if (closed) return;
          closed = true;
          cleanup();
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        const replayNewEvents = () => {
          const nextEvents = getRunEvents(runId, lastSeq);
          for (const event of nextEvents) {
            lastSeq = event.seq;
            send(event.type, {
              seq: event.seq,
              ts: event.ts,
              payload: JSON.parse(event.payload),
            });
          }
          return nextEvents;
        };

        replayNewEvents();

        // If run already finished, close immediately.
        const initialRun = getRun(runId);
        if (!initialRun || initialRun.status !== "running") {
          send("done", { runId });
          closeStream();
          return;
        }

        // Subscribe to live events for runs launched by this process.
        unsubscribe = subscribeRun(runId, (evt) => {
          send(evt.type, { seq: evt.seq, ts: evt.ts, payload: evt.payload });
          if (evt.type === "run:done") {
            closeStream();
          }
        });

        // Heartbeat every 20s to keep the connection alive
        hb = setInterval(() => {
          try {
            controller.enqueue(`: ping\n\n`);
          } catch {
            closeStream();
          }
        }, 20000);

        // For runs launched outside this server process, follow the DB instead.
        if (!isRunActive(runId)) {
          poll = setInterval(() => {
            const nextEvents = replayNewEvents();
            const currentRun = getRun(runId);
            if (!currentRun) {
              send("done", { runId });
              closeStream();
              return;
            }
            if (currentRun.status !== "running") {
              const hasTerminalEvent = nextEvents.some((event) => event.type === "run:done");
              if (!hasTerminalEvent) {
                send("run:done", {
                  seq: lastSeq + 1,
                  ts: new Date().toISOString(),
                  payload: {
                    status: currentRun.status,
                    totalTokens: currentRun.totalTokens,
                    totalCost: currentRun.totalCost,
                  },
                });
              }
              closeStream();
            }
          }, 1000);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      },
    });
  }

  if (runCancelParams && method === "POST") {
    const ok2 = cancelRun(runCancelParams.id ?? "");
    return json({ ok: ok2 });
  }

  // ── Context stores ─────────────────────────────────────
  if (method === "GET" && pathname === "/api/context") {
    const projectId = url.searchParams.get("projectId");
    const prefix = url.searchParams.get("prefix") ?? undefined;
    const projects = projectId
      ? [getIndexedProject(projectId)].filter((project): project is ProjectIndexEntry => project != null)
      : listIndexedProjects();

    if (projectId && projects.length === 0) return notFound("Project not registered");

    const stores = [];
    for (const project of projects) {
      const dbPath = join(getProjectDir(project.path), "context.db");
      if (!existsSync(dbPath)) {
        stores.push({
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          dbPath,
          exists: false,
          entries: [],
        });
        continue;
      }

      const store = createContextStore({ dbPath });
      try {
        const result = await store.list(prefix);
        if (!result.ok) return serverError(result.error.message);
        stores.push({
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          dbPath,
          exists: true,
          entries: result.value.map((entry) => ({
            key: entry.key,
            value: entry.value,
            createdBy: entry.createdBy,
            createdAt: entry.createdAt.toISOString(),
            expiresAt: entry.expiresAt?.toISOString() ?? null,
          })),
        });
      } finally {
        store.close();
      }
    }

    return json({ ok: true, stores });
  }

  // ── Providers ──────────────────────────────────────────
  if (method === "GET" && pathname === "/api/providers") {
    const configured = new Map(listProviders().map((p) => [p.id, p]));
    return json({
      ok: true,
      providers: PROVIDER_CATALOG.map((c) => ({
        id: c.id,
        name: c.name,
        baseUrl: c.baseUrl,
        type: c.type,
        category: c.category,
        description: c.description,
        signupUrl: c.signupUrl,
        requiresKey: c.requiresKey,
        configured: configured.has(c.id),
      })),
    });
  }

  if (method === "POST" && pathname === "/api/providers") {
    const body = await readJsonBody<{ id: string; apiKey: string }>(req);
    if (!body?.id || !body?.apiKey) return badRequest("`id` and `apiKey` required");
    const catalog = PROVIDER_CATALOG.find((p) => p.id === body.id);
    if (!catalog) return badRequest(`Unknown provider: ${body.id}`);
    const result = addProvider({
      id: catalog.id,
      name: catalog.name,
      apiKey: body.apiKey,
      baseUrl: catalog.baseUrl,
      type: catalog.type,
      addedAt: new Date().toISOString(),
    });
    if (!result.ok) return serverError(result.error.message);
    return json({ ok: true });
  }

  const providerParams = match(pathname, "/api/providers/:id");
  if (providerParams && method === "DELETE") {
    const result = removeGlobalProvider(providerParams.id ?? "");
    if (!result.ok) return serverError(result.error.message);
    return json({ ok: true, removed: result.value });
  }

  // ── Settings ───────────────────────────────────────────
  if (method === "GET" && pathname === "/api/settings") {
    return json({
      ok: true,
      config: loadOpenthkConfig(),
      configDir: getOpenthkConfigDir(),
    });
  }

  if (method === "PUT" && pathname === "/api/settings") {
    const body = await readJsonBody<{ ui?: { autostart?: boolean | null } }>(req);
    if (!body) return badRequest("JSON body required");
    const cfg = loadOpenthkConfig();

    if (body.ui && Object.prototype.hasOwnProperty.call(body.ui, "autostart")) {
      const autostart = body.ui.autostart;
      if (autostart != null && typeof autostart !== "boolean") {
        return badRequest("`ui.autostart` must be boolean or null");
      }
      const nextUi = { ...(cfg.ui ?? {}) };
      if (autostart == null) delete nextUi.autostart;
      else nextUi.autostart = autostart;
      cfg.ui = nextUi;
    }

    const result = saveOpenthkConfig(cfg);
    if (!result.ok) return serverError(result.error.message);
    return json({ ok: true, config: cfg, configDir: getOpenthkConfigDir() });
  }

  // ── Skills ─────────────────────────────────────────────
  if (method === "GET" && pathname === "/api/skills") {
    const projectId = url.searchParams.get("projectId");
    const includeGlobal = url.searchParams.get("includeGlobal") === "1";
    if (!projectId) {
      return json({ ok: true, skills: listGlobalSkillsForUi() });
    }

    const project = getIndexedProject(projectId);
    if (!project) return notFound("Project not registered");
    const projectSkills = listProjectSkillsForUi(project);
    return json({
      ok: true,
      skills: includeGlobal
        ? [...listGlobalSkillsForUi(), ...projectSkills]
        : projectSkills,
    });
  }

  if (method === "POST" && pathname === "/api/skills") {
    const body = await readJsonBody<{
      namespace: string;
      name: string;
      prompt?: string;
      manifest?: string;
      overwrite?: boolean;
      projectId?: string;
    }>(req);
    if (!body?.namespace || !body?.name) {
      return badRequest("`namespace` and `name` are required");
    }

    let rootPath = getGlobalSkillsDir();
    let scope: SkillEntry["scope"] = "global";
    let projectId: string | null = null;
    if (body.projectId) {
      const project = getIndexedProject(body.projectId);
      if (!project) return notFound("Project not registered");
      rootPath = getProjectSkillsDir(project.path);
      scope = "project";
      projectId = project.id;
    }

    try {
      const skill = createSkillInRoot({
        rootPath,
        namespace: body.namespace,
        name: body.name,
        prompt: body.prompt,
        manifest: body.manifest,
        overwrite: body.overwrite,
      });
      return json({
        ok: true,
        skill: { ...skill, scope, projectId },
      }, 201);
    } catch (e) {
      return badRequest((e as Error).message);
    }
  }

  if (method === "GET" && pathname === "/api/skills/content") {
    const path = url.searchParams.get("path");
    if (!path) return badRequest("`path` is required");

    const allowedRoots = [
      getGlobalSkillsDir(),
      ...listIndexedProjects().map((project) => getProjectSkillsDir(project.path)),
    ];

    try {
      return json({ ok: true, ...readSkillDocument(path, allowedRoots) });
    } catch (e) {
      return badRequest((e as Error).message);
    }
  }

  if (method === "PUT" && pathname === "/api/skills/content") {
    const body = await readJsonBody<{ path: string; prompt: string; manifest: string }>(req);
    if (!body?.path) return badRequest("`path` is required");

    const allowedRoots = [
      getGlobalSkillsDir(),
      ...listIndexedProjects().map((project) => getProjectSkillsDir(project.path)),
    ];

    try {
      saveSkillDocument({
        path: body.path,
        prompt: body.prompt ?? "",
        manifest: body.manifest ?? "",
        allowedRoots,
      });
      return json({ ok: true });
    } catch (e) {
      return badRequest((e as Error).message);
    }
  }

  if (method === "DELETE" && pathname === "/api/skills/content") {
    const path = url.searchParams.get("path");
    if (!path) return badRequest("`path` is required");

    const allowedRoots = [
      getGlobalSkillsDir(),
      ...listIndexedProjects().map((project) => getProjectSkillsDir(project.path)),
    ];

    try {
      deleteSkillDocument(path, allowedRoots);
      return json({ ok: true });
    } catch (e) {
      return badRequest((e as Error).message);
    }
  }

  // ── FS browse ──────────────────────────────────────────
  if (method === "GET" && pathname === "/api/fs/browse") {
    const target = url.searchParams.get("path") || homedir();
    const showHidden = url.searchParams.get("showHidden") === "1";
    try {
      const abs = resolve(target);
      const st = statSync(abs);
      if (!st.isDirectory()) return badRequest("path is not a directory");
      const entries = readdirSync(abs, { withFileTypes: true })
        .filter((e) => showHidden || !e.name.startsWith("."))
        .map((e) => ({
          name: e.name,
          path: join(abs, e.name),
          isDir: e.isDirectory(),
          isYaml: !e.isDirectory() && /\.ya?ml$/i.test(e.name),
        }))
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return json({ ok: true, path: abs, parent: dirname(abs), entries });
    } catch (e) {
      return badRequest(`Cannot read directory: ${(e as Error).message}`);
    }
  }

  return notFound();
}

// Re-export for type checking
export type { PipelineIndexEntry, RunStatus };
