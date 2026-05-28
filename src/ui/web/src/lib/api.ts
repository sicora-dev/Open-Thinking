/**
 * Thin fetch wrapper for the OpenThinking REST API.
 * All endpoints are same-origin (the UI is served by the same Bun server).
 */

export type PipelineEntry = {
  id: string;
  name: string;
  path: string;
  scope: "global" | "project";
  projectId: string | null;
  rootPath: string;
  addedAt: string;
  lastOpenedAt: string | null;
};

export type ProjectEntry = {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  pipelinesCount: number;
  skillsCount: number;
};

export type SkillEntry = {
  id: string;
  namespace: string;
  name: string;
  path: string;
  scope: "global" | "project";
  projectId: string | null;
};

export type SkillDocument = {
  prompt: string;
  manifest: string;
};

export type ProviderInfo = {
  id: string;
  name: string;
  baseUrl: string;
  type: string;
  category: "cloud" | "local";
  description: string;
  signupUrl?: string;
  requiresKey: boolean;
  configured: boolean;
  supported: boolean;
  fields: ProviderConfigField[];
  values: Record<string, string>;
  checkedAt: string | null;
};

export type ProviderConfigField = {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  required: boolean;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: string;
  configured?: boolean;
};

export type RunRow = {
  id: string;
  pipelineName: string;
  pipelinePath: string | null;
  input: string;
  status: "running" | "success" | "failed" | "cancelled";
  startedAt: string;
  endedAt: string | null;
  totalTokens: number;
  totalCost: number;
};

export type FsEntry = {
  name: string;
  path: string;
  isDir: boolean;
  isYaml: boolean;
};

export type ContextEntry = {
  key: string;
  value: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
};

export type ContextStoreInfo = {
  projectId: string;
  projectName: string;
  projectPath: string;
  dbPath: string;
  exists: boolean;
  entries: ContextEntry[];
};

export type UiSettings = {
  ui?: {
    autostart?: boolean;
  };
};

export type UiSettingsUpdate = {
  ui?: {
    autostart?: boolean | null;
  };
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => req<{ ok: boolean; version: string; port: number; startedAt: string }>("/api/health"),

  // Pipelines
  listPipelines: () =>
    req<{ pipelines: PipelineEntry[] }>("/api/pipelines").then((r) => r.pipelines),
  listProjectPipelines: (projectId: string) =>
    req<{ pipelines: PipelineEntry[] }>(`/api/projects/${projectId}/pipelines`).then((r) => r.pipelines),
  getPipeline: (id: string) =>
    req<{ entry: PipelineEntry; yaml: string; config: unknown; parseError: string | null }>(
      `/api/pipelines/${id}`,
    ),
  registerPipeline: (path: string, name?: string) =>
    req<{ pipeline: PipelineEntry }>("/api/pipelines", {
      method: "POST",
      body: JSON.stringify({ path, name }),
    }),
  createPipeline: (path: string, content: string, name?: string) =>
    req<{ pipeline: PipelineEntry }>("/api/pipelines", {
      method: "POST",
      body: JSON.stringify({ path, content, name }),
    }),
  createGlobalPipeline: (
    name: string,
    content: string,
    overwrite = false,
    fileName?: string,
  ) =>
    req<{ pipeline: PipelineEntry }>("/api/pipelines", {
      method: "POST",
      body: JSON.stringify({ name, content, overwrite, fileName }),
    }),
  createProjectPipeline: (
    projectId: string,
    name: string,
    content: string,
    overwrite = false,
    fileName?: string,
  ) =>
    req<{ pipeline: PipelineEntry }>(`/api/projects/${projectId}/pipelines`, {
      method: "POST",
      body: JSON.stringify({ name, content, overwrite, fileName }),
    }),
  validatePipeline: (content: string) =>
    req<{ ok: boolean; config?: unknown; error?: string }>("/api/pipelines/validate", {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  savePipeline: (id: string, content: string) =>
    req<{ ok: boolean }>(`/api/pipelines/${id}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  deletePipeline: (id: string) =>
    req<{ ok: boolean }>(`/api/pipelines/${id}`, { method: "DELETE" }),
  runPipeline: (id: string, input: string, options?: { projectId?: string | null }) =>
    req<{ runId: string }>(`/api/pipelines/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ input, projectId: options?.projectId ?? undefined }),
    }),

  // Runs
  listRuns: () => req<{ runs: RunRow[] }>("/api/runs").then((r) => r.runs),
  getRun: (id: string) =>
    req<{
      run: RunRow;
      events: Array<{ seq: number; ts: string; type: string; payload: unknown }>;
      active: boolean;
      cancellable: boolean;
    }>(`/api/runs/${id}`),
  cancelRun: (id: string) =>
    req<{ ok: boolean }>(`/api/runs/${id}/cancel`, { method: "POST" }),

  // Context
  listContext: (options?: { projectId?: string; prefix?: string }) => {
    const search = new URLSearchParams();
    if (options?.projectId) search.set("projectId", options.projectId);
    if (options?.prefix) search.set("prefix", options.prefix);
    const suffix = search.toString() ? `?${search.toString()}` : "";
    return req<{ stores: ContextStoreInfo[] }>(`/api/context${suffix}`).then((r) => r.stores);
  },

  // Providers
  listProviders: () =>
    req<{ providers: ProviderInfo[] }>("/api/providers").then((r) => r.providers),
  saveProvider: (id: string, values: Record<string, string>) =>
    req<{ ok: boolean; checkedAt: string }>("/api/providers", {
      method: "POST",
      body: JSON.stringify({ id, values }),
    }),
  checkProvider: (id: string) =>
    req<{ ok: boolean }>(`/api/providers/${id}/check`, { method: "POST" }),
  removeProvider: (id: string) =>
    req<{ ok: boolean }>(`/api/providers/${id}`, { method: "DELETE" }),

  // Settings
  getSettings: () =>
    req<{ config: UiSettings; configDir: string }>("/api/settings"),
  saveSettings: (config: UiSettingsUpdate) =>
    req<{ ok: boolean; config: UiSettings; configDir: string }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  // Projects
  listProjects: () =>
    req<{ projects: ProjectEntry[] }>("/api/projects").then((r) => r.projects),
  addProject: (path: string, name?: string) =>
    req<{ project: ProjectEntry }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ path, name }),
    }),
  removeProject: (id: string) =>
    req<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),

  // Skills
  listSkills: (options?: { projectId?: string; includeGlobal?: boolean }) => {
    const search = new URLSearchParams();
    if (options?.projectId) search.set("projectId", options.projectId);
    if (options?.includeGlobal) search.set("includeGlobal", "1");
    const suffix = search.toString() ? `?${search.toString()}` : "";
    return req<{ skills: SkillEntry[] }>(`/api/skills${suffix}`).then((r) => r.skills);
  },
  createSkill: (input: {
    namespace: string;
    name: string;
    prompt?: string;
    manifest?: string;
    overwrite?: boolean;
    projectId?: string;
  }) =>
    req<{ skill: SkillEntry }>("/api/skills", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getSkillContent: (path: string) =>
    req<SkillDocument>(`/api/skills/content?path=${encodeURIComponent(path)}`),
  saveSkillContent: (path: string, prompt: string, manifest: string) =>
    req<{ ok: boolean }>("/api/skills/content", {
      method: "PUT",
      body: JSON.stringify({ path, prompt, manifest }),
    }),
  deleteSkill: (path: string) =>
    req<{ ok: boolean }>(`/api/skills/content?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),

  // FS
  browse: (path?: string, options?: { showHidden?: boolean }) =>
    req<{ path: string; parent: string; entries: FsEntry[] }>(
      `/api/fs/browse?path=${encodeURIComponent(path ?? "")}${options?.showHidden ? "&showHidden=1" : ""}`,
    ),
  readFile: (path: string) =>
    req<{ content: string | null; tooBig: boolean }>(`/api/fs/read?path=${encodeURIComponent(path)}`),
};
