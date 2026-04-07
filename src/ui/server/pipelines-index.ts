/**
 * Pipeline registry. Maps user-friendly IDs to absolute YAML paths.
 *
 * Pipelines are YAML files at user-chosen locations on disk. The UI
 * keeps a small JSON index in ~/.openthk/pipelines-index.json so it
 * doesn't have to scan the filesystem and so users can register
 * pipelines from anywhere.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type Result, err, ok } from "../../shared/result";
import { getOpenthkConfigDir } from "../../config/paths";

function getIndexFile(): string {
  return join(getOpenthkConfigDir(), "pipelines-index.json");
}

export type PipelineIndexEntry = {
  id: string;
  name: string;
  path: string;
  scope: "global" | "project";
  projectId: string | null;
  rootPath: string;
  addedAt: string;
  lastOpenedAt: string | null;
};

type IndexFile = {
  pipelines: Record<string, PipelineIndexEntry>;
};

function ensureDir(): void {
  const configDir = getOpenthkConfigDir();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
}

function load(): IndexFile {
  const indexFile = getIndexFile();
  if (!existsSync(indexFile)) return { pipelines: {} };
  try {
    const parsed = JSON.parse(readFileSync(indexFile, "utf-8")) as IndexFile;
    for (const entry of Object.values(parsed.pipelines)) {
      entry.scope ??= "global";
      entry.projectId ??= null;
      entry.rootPath ??= dirname(entry.path);
    }
    return parsed;
  } catch {
    return { pipelines: {} };
  }
}

function save(index: IndexFile): Result<void> {
  try {
    ensureDir();
    writeFileSync(getIndexFile(), JSON.stringify(index, null, 2));
    return ok(undefined);
  } catch (e) {
    return err(new Error(`Failed to save pipeline index: ${(e as Error).message}`));
  }
}

function makeId(path: string): string {
  // Stable id from absolute path: hash-ish but readable
  const abs = resolve(path);
  const base = basename(abs).replace(/\.ya?ml$/, "");
  let hash = 0;
  for (let i = 0; i < abs.length; i++) {
    hash = (hash * 31 + abs.charCodeAt(i)) | 0;
  }
  return `${base}-${Math.abs(hash).toString(36)}`;
}

export function listIndexedPipelines(input?: {
  scope?: "global" | "project";
  projectId?: string;
}): PipelineIndexEntry[] {
  const index = load();
  return Object.values(index.pipelines)
    .filter((entry) => existsSync(entry.path))
    .filter((entry) => {
      if (input?.scope && entry.scope !== input.scope) return false;
      if (input?.projectId && entry.projectId !== input.projectId) return false;
      return true;
    })
    .sort((a, b) => {
      const at = a.lastOpenedAt ?? a.addedAt;
      const bt = b.lastOpenedAt ?? b.addedAt;
      return bt.localeCompare(at);
    });
}

export function getIndexedPipeline(id: string): PipelineIndexEntry | null {
  return load().pipelines[id] ?? null;
}

export function registerPipeline(input: {
  path: string;
  name: string;
  scope?: "global" | "project";
  projectId?: string | null;
  rootPath?: string;
}): Result<PipelineIndexEntry> {
  const abs = resolve(input.path);
  if (!existsSync(abs)) {
    return err(new Error(`File does not exist: ${abs}`));
  }
  const index = load();
  // De-dup by absolute path
  const existing = Object.values(index.pipelines).find((p) => p.path === abs);
  if (existing) {
    existing.name = input.name;
    existing.scope = input.scope ?? existing.scope ?? "global";
    existing.projectId = input.projectId ?? existing.projectId ?? null;
    existing.rootPath = input.rootPath ?? existing.rootPath ?? dirname(abs);
    const saveResult = save(index);
    if (!saveResult.ok) return saveResult;
    return ok(existing);
  }
  const entry: PipelineIndexEntry = {
    id: makeId(abs),
    name: input.name,
    path: abs,
    scope: input.scope ?? "global",
    projectId: input.projectId ?? null,
    rootPath: input.rootPath ?? dirname(abs),
    addedAt: new Date().toISOString(),
    lastOpenedAt: null,
  };
  index.pipelines[entry.id] = entry;
  const saveResult = save(index);
  if (!saveResult.ok) return saveResult;
  return ok(entry);
}

export function touchPipeline(id: string): void {
  const index = load();
  const entry = index.pipelines[id];
  if (!entry) return;
  entry.lastOpenedAt = new Date().toISOString();
  save(index);
}

export function unregisterPipeline(id: string): boolean {
  const index = load();
  if (!index.pipelines[id]) return false;
  delete index.pipelines[id];
  save(index);
  return true;
}
