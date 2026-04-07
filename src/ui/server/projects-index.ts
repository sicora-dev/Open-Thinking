import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { type Result, err, ok } from "../../shared/result";
import { getOpenthkConfigDir } from "../../config/paths";

function getIndexFile(): string {
  return join(getOpenthkConfigDir(), "projects-index.json");
}

export type ProjectIndexEntry = {
  id: string;
  name: string;
  path: string;
  addedAt: string;
};

type IndexFile = {
  projects: Record<string, ProjectIndexEntry>;
};

function ensureDir(): void {
  const configDir = getOpenthkConfigDir();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
}

function load(): IndexFile {
  const indexFile = getIndexFile();
  if (!existsSync(indexFile)) return { projects: {} };
  try {
    return JSON.parse(readFileSync(indexFile, "utf-8")) as IndexFile;
  } catch {
    return { projects: {} };
  }
}

function save(index: IndexFile): Result<void> {
  try {
    ensureDir();
    writeFileSync(getIndexFile(), JSON.stringify(index, null, 2));
    return ok(undefined);
  } catch (e) {
    return err(new Error(`Failed to save project index: ${(e as Error).message}`));
  }
}

function makeId(path: string): string {
  const abs = resolve(path);
  const base = basename(abs) || "project";
  let hash = 0;
  for (let i = 0; i < abs.length; i++) {
    hash = (hash * 31 + abs.charCodeAt(i)) | 0;
  }
  return `${base}-${Math.abs(hash).toString(36)}`;
}

export function listIndexedProjects(): ProjectIndexEntry[] {
  const index = load();
  return Object.values(index.projects).sort((a, b) => a.name.localeCompare(b.name));
}

export function getIndexedProject(id: string): ProjectIndexEntry | null {
  return load().projects[id] ?? null;
}

export function registerProject(input: {
  path: string;
  name?: string;
}): Result<ProjectIndexEntry> {
  const abs = resolve(input.path);
  if (!existsSync(abs)) {
    return err(new Error(`Directory does not exist: ${abs}`));
  }
  if (!statSync(abs).isDirectory()) {
    return err(new Error(`Path is not a directory: ${abs}`));
  }

  const index = load();
  const existing = Object.values(index.projects).find((project) => project.path === abs);
  if (existing) {
    if (input.name && input.name !== existing.name) {
      existing.name = input.name;
      const saveResult = save(index);
      if (!saveResult.ok) return saveResult;
    }
    return ok(existing);
  }

  const entry: ProjectIndexEntry = {
    id: makeId(abs),
    name: input.name?.trim() || basename(abs) || "project",
    path: abs,
    addedAt: new Date().toISOString(),
  };
  index.projects[entry.id] = entry;
  const saveResult = save(index);
  if (!saveResult.ok) return saveResult;
  return ok(entry);
}

export function unregisterProject(id: string): boolean {
  const index = load();
  if (!index.projects[id]) return false;
  delete index.projects[id];
  save(index);
  return true;
}
