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
 *   POST   /api/runs/:id/permission             — resolve a pending permission request
 *   GET    /api/runs/:id/permissions            — list pending permission requests
 *   POST   /api/runs/:id/error-recovery        — resolve error recovery (retry/skip/abort)
 *   GET    /api/runs/:id/error-recovery        — get pending error recovery state
 *   GET    /api/context                         — inspect project context stores
 *   GET    /api/context/snapshots               — list snapshots for a project
 *   POST   /api/context/snapshots               — save a snapshot
 *   POST   /api/context/snapshots/restore       — restore from a snapshot
 *   DELETE /api/context/snapshots/:id           — delete a snapshot
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
 *   GET    /api/permissions                      — list permission rules
 *   PUT    /api/permissions                      — add/update a permission rule
 *   DELETE /api/permissions                      — remove permission rule(s)
 *   DELETE /api/permissions/all                  — clear all rules
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
  buildProviderBaseUrl,
  getProviderEntry,
  listProviders,
  loadOpenthkConfig,
  providerEntryValues,
  removeProvider as removeGlobalProvider,
  saveOpenthkConfig,
  type CatalogProvider,
  type ProviderEntry,
} from "../../config";
import { getOpenthkConfigDir } from "../../config/paths";
import { createContextStore } from "../../context/store";
import { parsePipeline, parsePipelineFromString } from "../../pipeline/parser";
import { createProviderFromConfig } from "../../providers";
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
  appendEvent,
  finalizeRun,
  type RunStatus,
  getRun,
  getRunEvents,
  listRuns,
} from "./runs-store";
import { startRun, cancelRun, subscribeRun, isRunActive, resolvePermission, listPendingPermissions, resolveErrorRecovery, getPendingErrorRecovery } from "./run-manager";
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

type ProviderSaveBody = {
  id: string;
  apiKey?: string;
  values?: Record<string, string>;
};

function getProviderPublicValues(
  catalog: CatalogProvider,
  entry: ProviderEntry | null,
): Record<string, string> {
  const values = providerEntryValues(entry);
  const publicValues: Record<string, string> = {};
  for (const field of catalog.configFields) {
    if (field.secret) continue;
    const value = values[field.key] ?? field.defaultValue ?? "";
    if (value) publicValues[field.key] = value;
  }
  return publicValues;
}

function mergeProviderValues(
  catalog: CatalogProvider,
  entry: ProviderEntry | null,
  input: Record<string, string>,
): Record<string, string> {
  const current = providerEntryValues(entry);
  const merged: Record<string, string> = {};

  for (const field of catalog.configFields) {
    const raw = input[field.key];
    const nextValue = typeof raw === "string" ? raw.trim() : "";
    const currentValue = current[field.key] ?? "";
    const defaultValue = field.defaultValue ?? "";
    merged[field.key] = nextValue || (field.secret ? currentValue : currentValue || defaultValue);
  }

  return merged;
}

function validateProviderValues(
  catalog: CatalogProvider,
  values: Record<string, string>,
): string | null {
  if (catalog.supported === false) {
    return `${catalog.name} is not supported by the current provider adapter.`;
  }

  for (const field of catalog.configFields) {
    if (field.required && !values[field.key]) {
      return `${field.label} is required.`;
    }
  }

  if (catalog.id === "azure") {
    const baseUrl = buildProviderBaseUrl(catalog, values);
    if (!/^https:\/\/[^/]+/.test(baseUrl)) {
      return "Azure base URL must be an https URL.";
    }
    if (baseUrl.includes("{") || baseUrl.includes("}")) {
      return "Azure base URL must use your real resource name.";
    }
    if (baseUrl.includes("api-version=") && baseUrl.includes("/openai/v1")) {
      return "Azure v1 base URLs must not include api-version.";
    }
  }

  return null;
}

function isProviderConfigured(catalog: CatalogProvider, entry: ProviderEntry | null): boolean {
  if (!entry || catalog.supported === false) return false;
  const values = providerEntryValues(entry);
  return validateProviderValues(catalog, values) === null;
}

function isProviderFieldConfigured(
  catalog: CatalogProvider,
  entry: ProviderEntry | null,
  fieldKey: string,
): boolean {
  if (!entry) return false;
  const value = providerEntryValues(entry)[fieldKey] ?? "";
  if (!value) return false;
  if (catalog.id === "azure" && fieldKey === "baseUrl") {
    return !value.includes("{") && !value.includes("}");
  }
  return true;
}

function buildProviderEntry(
  catalog: CatalogProvider,
  values: Record<string, string>,
  existing: ProviderEntry | null,
): ProviderEntry {
  const baseUrl = buildProviderBaseUrl(catalog, values);
  const config: Record<string, string> = {};
  for (const field of catalog.configFields) {
    if (field.key === "apiKey" || field.key === "baseUrl") continue;
    const value = values[field.key];
    if (value) config[field.key] = value;
  }

  return {
    id: catalog.id,
    name: catalog.name,
    apiKey: values.apiKey || undefined,
    baseUrl,
    type: catalog.type,
    config,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
    checkedAt: new Date().toISOString(),
  };
}

async function checkProviderConnection(entry: ProviderEntry): Promise<{ ok: true } | { ok: false; error: string }> {
  const created = createProviderFromConfig(entry.id, {
    type: entry.type,
    base_url: entry.baseUrl,
    api_key: entry.apiKey,
    headers: entry.headers,
  });
  if (!created.ok) return { ok: false, error: created.error.message };

  const health = await created.value.healthCheck();
  if (!health.ok) return { ok: false, error: health.error.message };
  if (!health.value) {
    return {
      ok: false,
      error: "Provider check failed. Verify the endpoint and credentials.",
    };
  }

  return { ok: true };
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
    const body = await readJsonBody<{ input: string; projectId?: string | null }>(req);
    if (!body?.input) return badRequest("`input` is required");

    let workspace: { projectId: string; path: string } | null = null;
    if (entry.scope === "project") {
      if (!entry.projectId) return notFound("Project not registered");
      if (body.projectId && body.projectId !== entry.projectId) {
        return badRequest("Project pipelines must run in their own project workspace");
      }
      const project = getIndexedProject(entry.projectId);
      if (!project) return notFound("Project not registered");
      workspace = { projectId: project.id, path: project.path };
    } else if (body.projectId) {
      const project = getIndexedProject(body.projectId);
      if (!project) return notFound("Project not registered");
      workspace = { projectId: project.id, path: project.path };
    } else {
      return badRequest("Select a workspace before starting the run.");
    }

    const result = await startRun({ entry, input: body.input, workspace });
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
    const runId = runCancelParams.id ?? "";
    const activeCancelled = cancelRun(runId);
    if (activeCancelled) return json({ ok: true, stale: false });

    const run = getRun(runId);
    if (!run) return notFound();
    if (run.status === "running") {
      const events = getRunEvents(runId, 0);
      const nextSeq = events.reduce((max, event) => Math.max(max, event.seq), 0) + 1;
      finalizeRun(runId, "cancelled", {
        tokens: run.totalTokens,
        cost: run.totalCost,
      });
      appendEvent(runId, nextSeq, "run:error", {
        error: "Run was marked cancelled because its worker process is no longer active.",
      });
      appendEvent(runId, nextSeq + 1, "run:done", {
        status: "cancelled",
        totalTokens: run.totalTokens,
        totalCost: run.totalCost,
        stale: true,
      });
      return json({ ok: true, stale: true });
    }

    return json({ ok: false });
  }

  // POST /api/runs/:id/permission — resolve a pending permission request
  const runPermParams = match(pathname, "/api/runs/:id/permission");
  if (runPermParams && method === "POST") {
    const body = await readJsonBody<{ requestId: string; action: "allow" | "deny"; remember?: boolean }>(req);
    if (!body?.requestId || !body?.action) {
      return badRequest("`requestId` and `action` are required");
    }
    const resolved = resolvePermission(
      runPermParams.id ?? "",
      body.requestId,
      body.action,
      body.remember ?? false,
    );
    return json({ ok: resolved });
  }

  // GET /api/runs/:id/permissions — list pending permission requests
  const runPermsParams = match(pathname, "/api/runs/:id/permissions");
  if (runPermsParams && method === "GET") {
    const pending = listPendingPermissions(runPermsParams.id ?? "");
    return json({ ok: true, pending });
  }

  // POST /api/runs/:id/error-recovery — resolve a paused error recovery decision
  const runErrorParams = match(pathname, "/api/runs/:id/error-recovery");
  if (runErrorParams && method === "POST") {
    const body = await readJsonBody<{ action: "retry" | "skip" | "abort" }>(req);
    if (!body?.action || !["retry", "skip", "abort"].includes(body.action)) {
      return badRequest("`action` must be 'retry', 'skip', or 'abort'");
    }
    const resolved = resolveErrorRecovery(runErrorParams.id ?? "", body.action);
    return json({ ok: resolved });
  }

  // GET /api/runs/:id/error-recovery — get pending error recovery state
  if (runErrorParams && method === "GET") {
    const pending = getPendingErrorRecovery(runErrorParams.id ?? "");
    return json({ ok: true, pending });
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

  // ── Context snapshots ────────────────────────────────────
  if (method === "GET" && pathname === "/api/context/snapshots") {
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return badRequest("`projectId` is required");
    const project = getIndexedProject(projectId);
    if (!project) return notFound("Project not registered");

    const dbPath = join(getProjectDir(project.path), "context.db");
    if (!existsSync(dbPath)) return json({ ok: true, snapshots: [] });

    const store = createContextStore({ dbPath });
    try {
      const result = store.listSnapshots();
      if (!result.ok) return serverError(result.error.message);
      return json({ ok: true, snapshots: result.value });
    } finally {
      store.close();
    }
  }

  if (method === "POST" && pathname === "/api/context/snapshots") {
    const body = await readJsonBody<{ projectId: string; name: string; description?: string }>(req);
    if (!body?.projectId || !body?.name) return badRequest("`projectId` and `name` are required");

    const project = getIndexedProject(body.projectId);
    if (!project) return notFound("Project not registered");

    const dbPath = join(getProjectDir(project.path), "context.db");
    if (!existsSync(dbPath)) return badRequest("No context store for this project");

    const store = createContextStore({ dbPath });
    try {
      const result = store.saveSnapshot(body.name, "ui", body.description);
      if (!result.ok) return serverError(result.error.message);
      return json({ ok: true, snapshot: result.value });
    } finally {
      store.close();
    }
  }

  if (method === "POST" && pathname === "/api/context/snapshots/restore") {
    const body = await readJsonBody<{ projectId: string; snapshotId: string }>(req);
    if (!body?.projectId || !body?.snapshotId) return badRequest("`projectId` and `snapshotId` are required");

    const project = getIndexedProject(body.projectId);
    if (!project) return notFound("Project not registered");

    const dbPath = join(getProjectDir(project.path), "context.db");
    if (!existsSync(dbPath)) return badRequest("No context store for this project");

    const store = createContextStore({ dbPath });
    try {
      const result = store.restoreSnapshot(body.snapshotId);
      if (!result.ok) return serverError(result.error.message);
      return json({ ok: true, restored: result.value.restored });
    } finally {
      store.close();
    }
  }

  const snapshotDeleteParams = match(pathname, "/api/context/snapshots/:id");
  if (snapshotDeleteParams && method === "DELETE") {
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return badRequest("`projectId` query parameter is required");

    const project = getIndexedProject(projectId);
    if (!project) return notFound("Project not registered");

    const dbPath = join(getProjectDir(project.path), "context.db");
    if (!existsSync(dbPath)) return badRequest("No context store for this project");

    const store = createContextStore({ dbPath });
    try {
      const result = store.deleteSnapshot(snapshotDeleteParams.id ?? "");
      if (!result.ok) return serverError(result.error.message);
      return json({ ok: true, deleted: result.value });
    } finally {
      store.close();
    }
  }

  // ── Providers ──────────────────────────────────────────
  if (method === "GET" && pathname === "/api/providers") {
    const configured = new Map(listProviders().map((p) => [p.id, p]));
    return json({
      ok: true,
      providers: PROVIDER_CATALOG.map((c) => {
        const entry = configured.get(c.id) ?? null;
        const isConfigured = isProviderConfigured(c, entry);
        return {
          id: c.id,
          name: c.name,
          baseUrl: entry?.baseUrl ?? c.baseUrl,
          type: c.type,
          category: c.category,
          description: c.description,
          signupUrl: c.signupUrl,
          requiresKey: c.requiresKey,
          configured: isConfigured,
          supported: c.supported !== false,
          fields: c.configFields.map((field) => ({
            ...field,
            configured: isProviderFieldConfigured(c, entry, field.key),
          })),
          values: getProviderPublicValues(c, entry),
          checkedAt: entry?.checkedAt ?? null,
        };
      }),
    });
  }

  if (method === "POST" && pathname === "/api/providers") {
    const body = await readJsonBody<ProviderSaveBody>(req);
    if (!body?.id) return badRequest("`id` is required");
    const catalog = PROVIDER_CATALOG.find((p) => p.id === body.id);
    if (!catalog) return badRequest(`Unknown provider: ${body.id}`);

    const existing = getProviderEntry(catalog.id);
    const inputValues = { ...(body.values ?? {}) };
    if (body.apiKey) inputValues.apiKey = body.apiKey;
    const values = mergeProviderValues(catalog, existing, inputValues);
    const validationError = validateProviderValues(catalog, values);
    if (validationError) return badRequest(validationError);

    const entry = buildProviderEntry(catalog, values, existing);
    const check = await checkProviderConnection(entry);
    if (!check.ok) return badRequest(check.error);

    const result = addProvider(entry);
    if (!result.ok) return serverError(result.error.message);
    return json({ ok: true, checkedAt: entry.checkedAt });
  }

  const providerCheckParams = match(pathname, "/api/providers/:id/check");
  if (providerCheckParams && method === "POST") {
    const catalog = PROVIDER_CATALOG.find((p) => p.id === (providerCheckParams.id ?? ""));
    if (!catalog) return notFound("Provider not found");
    const existing = getProviderEntry(catalog.id);
    if (!existing) return badRequest("Provider is not configured");
    const validationError = validateProviderValues(catalog, providerEntryValues(existing));
    if (validationError) return badRequest(validationError);
    const check = await checkProviderConnection(existing);
    if (!check.ok) return badRequest(check.error);
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

  // ── Permissions ─────────────────────────────────────────
  if (method === "GET" && pathname === "/api/permissions") {
    const { createPermissionStore } = await import("../../core/permissions");
    const store = createPermissionStore();
    return json({ ok: true, rules: store.listRules() });
  }

  if (method === "PUT" && pathname === "/api/permissions") {
    const body = await readJsonBody<{ tool: string; pattern: string; action: "allow" | "deny" }>(req);
    if (!body || !body.tool || !body.pattern || !body.action) {
      return badRequest("`tool`, `pattern`, and `action` are required");
    }
    const { createPermissionStore } = await import("../../core/permissions");
    const store = createPermissionStore();
    store.addRule(body.tool, body.pattern, body.action);
    return json({ ok: true });
  }

  if (method === "DELETE" && pathname === "/api/permissions") {
    const tool = url.searchParams.get("tool");
    const pattern = url.searchParams.get("pattern") ?? undefined;
    if (!tool) return badRequest("`tool` query parameter is required");
    const { createPermissionStore } = await import("../../core/permissions");
    const store = createPermissionStore();
    const count = store.removeRule(tool, pattern);
    return json({ ok: true, removed: count });
  }

  if (method === "DELETE" && pathname === "/api/permissions/all") {
    const { createPermissionStore } = await import("../../core/permissions");
    const store = createPermissionStore();
    store.clearRules();
    return json({ ok: true });
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
