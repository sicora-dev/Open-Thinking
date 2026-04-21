/**
 * API smoke tests. Spins up a real UI server and hits HTTP endpoints.
 * Run pipelines are NOT executed here (no real provider keys); we cover
 * registration, listing, validation, providers, fs browse, and runs list.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { saveGlobalConfig } from "../../config";
import { createContextStore } from "../../context/store";
import { readLock, removeLock } from "./lock";
import { startUi, stopUi } from "./lifecycle";
import { appendEvent, createRun } from "./runs-store";

let baseUrl = "";
let tmp = "";
let configDir = "";

beforeAll(async () => {
  // Make sure no leftover server
  const lock = readLock();
  if (lock) {
    try {
      process.kill(lock.pid, "SIGKILL");
    } catch {}
    removeLock();
  }
  configDir = mkdtempSync(join(tmpdir(), "openthk-ui-config-"));
  process.env.OPENTHK_CONFIG_DIR = configDir;
  process.env.OPENTHK_UI_CLI_ENTRY = resolve(process.cwd(), "src/cli/index.ts");
  const result = await startUi({});
  if (!result.ok) throw new Error(`startUi failed: ${result.error.message}`);
  baseUrl = `http://127.0.0.1:${result.value.port}`;
  tmp = mkdtempSync(join(tmpdir(), "openthk-ui-test-"));
});

afterAll(async () => {
  await stopUi();
  rmSync(configDir, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.OPENTHK_CONFIG_DIR;
  delete process.env.OPENTHK_UI_CLI_ENTRY;
});

describe("API", () => {
  test("GET /api/health", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe("string");
  });

  test("GET /api/providers lists catalog", async () => {
    const res = await fetch(`${baseUrl}/api/providers`);
    const body = (await res.json()) as {
      ok: boolean;
      providers: Array<{
        id: string;
        supported: boolean;
        fields?: Array<{ key: string; required: boolean }>;
      }>;
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.providers.length).toBeGreaterThan(0);
    expect(body.providers.find((provider) => provider.id === "azure")?.fields?.map((field) => field.key)).toEqual([
      "baseUrl",
      "apiKey",
    ]);
    expect(body.providers.find((provider) => provider.id === "bedrock")?.supported).toBe(false);
  });

  test("GET /api/providers marks placeholder Azure config as not configured", async () => {
    const save = saveGlobalConfig({
      providers: {
        azure: {
          id: "azure",
          name: "Azure OpenAI",
          apiKey: "secret",
          baseUrl: "https://{resource}.openai.azure.com/openai/deployments/{deployment}",
          type: "openai-compatible",
          addedAt: new Date().toISOString(),
        },
      },
    });
    expect(save.ok).toBe(true);

    const res = await fetch(`${baseUrl}/api/providers`);
    const body = (await res.json()) as {
      ok: boolean;
      providers: Array<{
        id: string;
        configured: boolean;
        fields?: Array<{ key: string; configured: boolean }>;
      }>;
    };
    const azure = body.providers.find((provider) => provider.id === "azure");
    expect(body.ok).toBe(true);
    expect(azure?.configured).toBe(false);
    expect(azure?.fields?.find((field) => field.key === "baseUrl")?.configured).toBe(false);

    const clear = saveGlobalConfig({ providers: {} });
    expect(clear.ok).toBe(true);
  });

  test("GET and PUT /api/settings use real UI config", async () => {
    const put = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ui: { autostart: true } }),
    });
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as {
      ok: boolean;
      config: { ui?: { autostart?: boolean } };
      configDir: string;
    };
    expect(putBody.ok).toBe(true);
    expect(putBody.config.ui?.autostart).toBe(true);
    expect(putBody.configDir).toBe(configDir);

    const get = await fetch(`${baseUrl}/api/settings`);
    const getBody = (await get.json()) as {
      ok: boolean;
      config: { ui?: { autostart?: boolean } };
    };
    expect(getBody.ok).toBe(true);
    expect(getBody.config.ui?.autostart).toBe(true);
  });

  test("GET /api/fs/browse returns directory entries", async () => {
    const res = await fetch(
      `${baseUrl}/api/fs/browse?path=${encodeURIComponent(tmp)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; entries: unknown[] };
    expect(body.ok).toBe(true);
  });

  test("POST /api/pipelines creates a managed global pipeline", async () => {
    const res = await fetch(`${baseUrl}/api/pipelines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "test-pipe",
        content: `name: test-pipe
version: "0.1.0"
mode: sequential
providers:
  - openai
stages:
  greet:
    provider: openai
    model: gpt-4o
    skill: core/echo@1.0
    context:
      read: ["input.*"]
      write: ["greet.*"]
`,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: boolean;
      pipeline: { id: string; scope: string; path: string };
    };
    expect(body.ok).toBe(true);
    expect(body.pipeline.id).toBeDefined();
    expect(body.pipeline.scope).toBe("global");
    expect(body.pipeline.path).toContain("/pipelines/");
    expect(body.pipeline.path.startsWith(configDir)).toBe(true);

    // Now list and ensure it's there
    const list = await fetch(`${baseUrl}/api/pipelines`);
    const listBody = (await list.json()) as { pipelines: Array<{ id: string }> };
    expect(listBody.pipelines.some((p) => p.id === body.pipeline.id)).toBe(true);

    // Fetch by id
    const get = await fetch(`${baseUrl}/api/pipelines/${body.pipeline.id}`);
    expect(get.status).toBe(200);
    const getBody = (await get.json()) as { ok: boolean; yaml: string };
    expect(getBody.ok).toBe(true);
    expect(getBody.yaml).toContain("test-pipe");

    // Delete (unregister)
    const del = await fetch(`${baseUrl}/api/pipelines/${body.pipeline.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
  });

  test("POST /api/pipelines/validate validates draft YAML", async () => {
    const res = await fetch(`${baseUrl}/api/pipelines/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: `name: validate-me
version: "0.1.0"
mode: sequential
providers:
  - openai
stages:
  draft:
    provider: openai
    model: gpt-4o
    skill: core/echo@1.0
    system_message: "Focus on concise output."
    context:
      read: ["input.*"]
      write: ["draft.*"]
`,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(true);
    expect(body.error).toBeUndefined();
  });

  test("POST /api/pipelines/:id/run rejects an unknown workspace project", async () => {
    const createPipeline = await fetch(`${baseUrl}/api/pipelines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "workspace-run",
        content: "name: workspace-run\nversion: \"0.1.0\"\nmode: sequential\nproviders: []\nstages: {}\n",
      }),
    });
    expect(createPipeline.status).toBe(201);
    const pipelineBody = (await createPipeline.json()) as {
      pipeline: { id: string };
    };

    const run = await fetch(`${baseUrl}/api/pipelines/${pipelineBody.pipeline.id}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hello", projectId: "missing-project" }),
    });
    expect(run.status).toBe(404);

    await fetch(`${baseUrl}/api/pipelines/${pipelineBody.pipeline.id}`, {
      method: "DELETE",
    });
  });

  test("projects endpoint registers a project and creates project-local pipelines", async () => {
    const projectDir = join(tmp, "sample-project");
    mkdirSync(projectDir, { recursive: true });

    const createProject = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: projectDir }),
    });
    expect(createProject.status).toBe(201);
    const projectBody = (await createProject.json()) as {
      ok: boolean;
      project: { id: string; path: string; pipelinesCount: number };
    };
    expect(projectBody.ok).toBe(true);
    expect(projectBody.project.id).toBeDefined();
    expect(projectBody.project.path).toBe(projectDir);

    const createPipeline = await fetch(`${baseUrl}/api/projects/${projectBody.project.id}/pipelines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "local-dev",
        content: `name: local-dev
version: "0.1.0"
mode: sequential
providers:
  - openai
stages:
  draft:
    provider: openai
    model: gpt-4o
    skill: core/echo@1.0
    context:
      read: ["input.*"]
      write: ["draft.*"]
`,
      }),
    });
    expect(createPipeline.status).toBe(201);
    const pipelineBody = (await createPipeline.json()) as {
      ok: boolean;
      pipeline: { scope: string; projectId: string | null; path: string };
    };
    expect(pipelineBody.ok).toBe(true);
    expect(pipelineBody.pipeline.scope).toBe("project");
    expect(pipelineBody.pipeline.projectId).toBe(projectBody.project.id);
    expect(pipelineBody.pipeline.path).toContain("/.openthk/pipelines/");

    const listProjectPipelines = await fetch(`${baseUrl}/api/projects/${projectBody.project.id}/pipelines`);
    expect(listProjectPipelines.status).toBe(200);
    const listed = (await listProjectPipelines.json()) as {
      ok: boolean;
      pipelines: Array<{ name: string; scope: string }>;
    };
    expect(listed.ok).toBe(true);
    expect(listed.pipelines.some((pipeline) => pipeline.name === "local-dev" && pipeline.scope === "project")).toBe(true);

    const createSkill = await fetch(`${baseUrl}/api/skills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: projectBody.project.id,
        namespace: "local",
        name: "draft",
      }),
    });
    expect(createSkill.status).toBe(201);
    const skillBody = (await createSkill.json()) as {
      ok: boolean;
      skill: { scope: string; projectId: string | null; path: string };
    };
    expect(skillBody.ok).toBe(true);
    expect(skillBody.skill.scope).toBe("project");
    expect(skillBody.skill.projectId).toBe(projectBody.project.id);
    expect(skillBody.skill.path).toContain("/.openthk/pipelines/skills/");

    const listProjectSkills = await fetch(`${baseUrl}/api/projects/${projectBody.project.id}/skills`);
    expect(listProjectSkills.status).toBe(200);
    const listedSkills = (await listProjectSkills.json()) as {
      ok: boolean;
      skills: Array<{ id: string; scope: string }>;
    };
    expect(listedSkills.ok).toBe(true);
    expect(
      listedSkills.skills.some((skill) => skill.id === "local/draft" && skill.scope === "project"),
    ).toBe(true);
  });

  test("pipeline endpoints reject paths outside managed roots", async () => {
    const outsideGlobal = join(tmp, "outside-global.yaml");
    writeFileSync(outsideGlobal, "name: outside\nversion: \"0.1.0\"\nmode: sequential\nproviders: []\nstages: {}\n");

    const createGlobal = await fetch(`${baseUrl}/api/pipelines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: outsideGlobal,
        content: "name: blocked\nversion: \"0.1.0\"\nmode: sequential\nproviders: []\nstages: {}\n",
      }),
    });
    expect(createGlobal.status).toBe(400);

    const projectDir = join(tmp, "strict-project");
    mkdirSync(projectDir, { recursive: true });
    const createProject = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: projectDir }),
    });
    expect(createProject.status).toBe(201);
    const projectBody = (await createProject.json()) as {
      project: { id: string };
    };

    const outsideProject = join(projectDir, "outside-project.yaml");
    const createProjectPipeline = await fetch(
      `${baseUrl}/api/projects/${projectBody.project.id}/pipelines`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: outsideProject,
          content: "name: blocked\nversion: \"0.1.0\"\nmode: sequential\nproviders: []\nstages: {}\n",
        }),
      },
    );
    expect(createProjectPipeline.status).toBe(400);
  });

  test("fs browse can include hidden directories when requested", async () => {
    const projectDir = join(tmp, "hidden-project");
    mkdirSync(join(projectDir, ".openthk"), { recursive: true });

    const res = await fetch(
      `${baseUrl}/api/fs/browse?path=${encodeURIComponent(projectDir)}&showHidden=1`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      entries: Array<{ name: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.entries.some((entry) => entry.name === ".openthk")).toBe(true);
  });

  test("GET /api/context returns project context store entries", async () => {
    const projectDir = join(tmp, "context-project");
    mkdirSync(projectDir, { recursive: true });
    const projectRes = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: projectDir, name: "context-project" }),
    });
    expect(projectRes.status).toBe(201);
    const projectBody = (await projectRes.json()) as {
      project: { id: string };
    };

    const store = createContextStore({
      dbPath: join(projectDir, ".openthk", "context.db"),
    });
    await store.set("plan.summary", "real context value", "test");
    store.close();

    const res = await fetch(
      `${baseUrl}/api/context?projectId=${encodeURIComponent(projectBody.project.id)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      stores: Array<{ entries: Array<{ key: string; value: string }> }>;
    };
    expect(body.ok).toBe(true);
    expect(body.stores[0]?.entries.some((entry) => entry.key === "plan.summary" && entry.value === "real context value")).toBe(true);
  });

  test("GET /api/runs returns a list (possibly empty)", async () => {
    const res = await fetch(`${baseUrl}/api/runs`);
    const body = (await res.json()) as { ok: boolean; runs: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.runs)).toBe(true);
  });

  test("GET /api/runs/:id treats persisted CLI runs as active but not cancellable", async () => {
    createRun({
      id: "cli-run-1",
      pipelineName: "cli-pipeline",
      pipelinePath: join(tmp, "cli.yaml"),
      input: "build a todo app",
    });
    appendEvent("cli-run-1", 1, "pipeline:start", {
      type: "pipeline:start",
      pipelineName: "cli-pipeline",
      runId: "cli-run-1",
    });

    const res = await fetch(`${baseUrl}/api/runs/cli-run-1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      active: boolean;
      cancellable: boolean;
      run: { status: string };
      events: Array<{ type: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.run.status).toBe("running");
    expect(body.active).toBe(true);
    expect(body.cancellable).toBe(false);
    expect(body.events.some((event) => event.type === "pipeline:start")).toBe(true);
  });

  test("404 on unknown route", async () => {
    const res = await fetch(`${baseUrl}/api/nope`);
    expect(res.status).toBe(404);
  });
});
