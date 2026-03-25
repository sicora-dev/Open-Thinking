/**
 * Project workspace management.
 *
 * Manages the `.openthk/` directory in each project and `~/.openthk/` globally.
 * Handles persistent context: project.md, stages/*.md, history/, learned/, user.md.
 * Manages the pipeline registry: pipelines/ in both project and user levels.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Pipeline Registry Types ────────────────────────────────

export type PipelineOrigin = "project" | "user";

export type PipelineEntry = {
  /** Pipeline name derived from filename (without extension) */
  name: string;
  /** Where this pipeline lives */
  origin: PipelineOrigin;
  /** Absolute path to the YAML file */
  path: string;
};

export type UserPreferences = {
  /** Per-project pipeline conflict resolution: key is `workingDir::pipelineName` */
  pipelineDefaults: Record<string, PipelineOrigin>;
};

// ─── Paths ───────────────────────────────────────────────────

const GLOBAL_DIR = join(homedir(), ".openthk");

export function getGlobalDir(): string {
  return GLOBAL_DIR;
}

export function getProjectDir(workingDir: string): string {
  return join(workingDir, ".openthk");
}

// ─── Initialization ──────────────────────────────────────────

/**
 * Ensure the global ~/.openthk/ directory exists with all subdirs.
 */
export function ensureGlobalWorkspace(): void {
  mkdirSync(join(GLOBAL_DIR, "learned"), { recursive: true });
  mkdirSync(join(GLOBAL_DIR, "pipelines"), { recursive: true });

  // Create default user.md if it doesn't exist
  const userMdPath = join(GLOBAL_DIR, "user.md");
  if (!existsSync(userMdPath)) {
    writeFileSync(
      userMdPath,
      "# User Preferences\n\n" +
        "<!-- Edit this file to set global preferences that apply to ALL projects. -->\n" +
        "<!-- These are injected into every stage's context. -->\n\n" +
        "## Language\n\n## Code Style\n\n## Tools\n",
    );
  }
}

/**
 * Ensure a .gitignore file contains all required entries.
 * Reads existing content, adds only entries that are missing, preserves user edits.
 */
function ensureGitignoreEntries(dir: string, entries: string[]): void {
  const gitignorePath = join(dir, ".gitignore");
  const existing = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf-8")
    : "";

  const existingLines = new Set(
    existing.split("\n").map((l) => l.trim()).filter(Boolean),
  );

  const missing = entries.filter((e) => !existingLines.has(e));
  if (missing.length === 0) return;

  const header = existing.trim() ? "" : "# Ephemeral state — don't commit\n";
  const separator = existing.endsWith("\n") || existing === "" ? "" : "\n";
  writeFileSync(gitignorePath, existing + separator + header + missing.join("\n") + "\n");
}

/**
 * Initialize the .openthk/ directory in a project.
 * Returns true if created, false if it already existed.
 */
export function initProjectWorkspace(workingDir: string): boolean {
  const projectDir = getProjectDir(workingDir);
  const existed = existsSync(projectDir);

  mkdirSync(join(projectDir, "stages"), { recursive: true });
  mkdirSync(join(projectDir, "pipelines"), { recursive: true });
  mkdirSync(join(projectDir, "history"), { recursive: true });
  mkdirSync(join(projectDir, "learned"), { recursive: true });

  // Create project.md if it doesn't exist
  const projectMdPath = join(projectDir, "project.md");
  if (!existsSync(projectMdPath)) {
    writeFileSync(
      projectMdPath,
      "# Project\n\n" +
        "<!-- This is the project's \"soul\" — shared knowledge injected into every stage. -->\n" +
        "<!-- Edit this file to describe your project, tech stack, and conventions. -->\n" +
        "<!-- Commit this file to version control so the whole team shares it. -->\n\n" +
        "## What is this project?\n\n## Tech Stack\n\n## Structure\n\n## Conventions\n",
    );
  }

  // Ensure .gitignore has all required entries
  ensureGitignoreEntries(projectDir, [
    "context.db*",
    "history/",
    "learned/mistakes.md",
    "active-pipeline",
  ]);

  return !existed;
}

/**
 * Check if a project workspace exists.
 */
export function hasProjectWorkspace(workingDir: string): boolean {
  return existsSync(getProjectDir(workingDir));
}

// ─── Reading context files ───────────────────────────────────

/**
 * Read the global user.md preferences.
 */
export function readUserPreferences(): string | null {
  const path = join(GLOBAL_DIR, "user.md");
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf-8").trim();
  // Don't return if it's just the template with no actual content
  if (content.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("<!--")).length === 0) {
    return null;
  }
  return content;
}

/**
 * Read the project.md soul file.
 */
export function readProjectSoul(workingDir: string): string | null {
  const path = join(getProjectDir(workingDir), "project.md");
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf-8").trim();
  if (content.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("<!--")).length === 0) {
    return null;
  }
  return content;
}

/**
 * Read stage-specific instructions (e.g., stages/coder.md).
 */
export function readStageInstructions(workingDir: string, stageName: string): string | null {
  const path = join(getProjectDir(workingDir), "stages", `${stageName}.md`);
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf-8").trim();
  return content || null;
}

/**
 * Read all learned/*.md files and combine them.
 */
export function readLearned(workingDir: string): string | null {
  const dirs = [
    join(getProjectDir(workingDir), "learned"),
    join(GLOBAL_DIR, "learned"),
  ];

  const sections: string[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
    for (const file of files) {
      const content = readFileSync(join(dir, file), "utf-8").trim();
      if (content) {
        sections.push(content);
      }
    }
  }

  return sections.length > 0 ? sections.join("\n\n---\n\n") : null;
}

/**
 * Read recent execution history (last N entries).
 */
export function readRecentHistory(workingDir: string, limit = 5): string | null {
  const historyDir = join(getProjectDir(workingDir), "history");
  if (!existsSync(historyDir)) return null;

  const files = readdirSync(historyDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()
    .slice(0, limit);

  if (files.length === 0) return null;

  const entries: string[] = [];
  for (const file of files) {
    const content = readFileSync(join(historyDir, file), "utf-8").trim();
    if (content) {
      entries.push(content);
    }
  }

  return entries.length > 0 ? entries.join("\n\n---\n\n") : null;
}

// ─── Writing context files ───────────────────────────────────

/**
 * Write an execution history entry.
 */
export function writeHistoryEntry(workingDir: string, content: string): string {
  const historyDir = join(getProjectDir(workingDir), "history");
  mkdirSync(historyDir, { recursive: true });

  // Generate filename: YYYY-MM-DD_NNN.md
  const today = new Date().toISOString().split("T")[0];
  const existing = readdirSync(historyDir).filter((f) => f.startsWith(today!));
  const seq = String(existing.length + 1).padStart(3, "0");
  const filename = `${today}_${seq}.md`;

  const filePath = join(historyDir, filename);
  writeFileSync(filePath, content);
  return filename;
}

/**
 * Write or update a learned file.
 */
export function writeLearned(workingDir: string, filename: string, content: string): void {
  const learnedDir = join(getProjectDir(workingDir), "learned");
  mkdirSync(learnedDir, { recursive: true });
  writeFileSync(join(learnedDir, filename), content);
}

/**
 * Update project.md with new content.
 */
export function writeProjectSoul(workingDir: string, content: string): void {
  const path = join(getProjectDir(workingDir), "project.md");
  writeFileSync(path, content);
}

// ─── Purging ─────────────────────────────────────────────────

/**
 * Purge old history entries beyond a certain age.
 */
export function purgeOldHistory(workingDir: string, maxAgeDays = 30): number {
  const historyDir = join(getProjectDir(workingDir), "history");
  if (!existsSync(historyDir)) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const cutoffStr = cutoff.toISOString().split("T")[0]!;

  let purged = 0;
  const files = readdirSync(historyDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const fileDate = file.slice(0, 10); // YYYY-MM-DD
    if (fileDate < cutoffStr) {
      unlinkSync(join(historyDir, file));
      purged++;
    }
  }

  return purged;
}

// ─── Build full context for a stage ──────────────────────────

export type StageContext = {
  /** Global user preferences (~/.openthk/user.md) */
  userPreferences: string | null;
  /** Project soul (.openthk/project.md) */
  projectSoul: string | null;
  /** Stage-specific instructions (.openthk/stages/<name>.md) */
  stageInstructions: string | null;
  /** Learned knowledge (.openthk/learned/ + ~/.openthk/learned/) */
  learned: string | null;
  /** Recent execution history (.openthk/history/) */
  recentHistory: string | null;
};

/**
 * Load all persistent context for a stage.
 */
export function loadStageContext(workingDir: string, stageName: string): StageContext {
  return {
    userPreferences: readUserPreferences(),
    projectSoul: readProjectSoul(workingDir),
    stageInstructions: readStageInstructions(workingDir, stageName),
    learned: readLearned(workingDir),
    recentHistory: readRecentHistory(workingDir),
  };
}

/**
 * Format persistent context as a string block for injection into the system prompt.
 */
export function formatPersistentContext(ctx: StageContext): string {
  const sections: string[] = [];

  if (ctx.projectSoul) {
    sections.push(`<project>\n${ctx.projectSoul}\n</project>`);
  }

  if (ctx.userPreferences) {
    sections.push(`<user-preferences>\n${ctx.userPreferences}\n</user-preferences>`);
  }

  if (ctx.stageInstructions) {
    sections.push(`<stage-instructions>\n${ctx.stageInstructions}\n</stage-instructions>`);
  }

  if (ctx.learned) {
    sections.push(`<learned>\n${ctx.learned}\n</learned>`);
  }

  if (ctx.recentHistory) {
    sections.push(`<recent-history>\n${ctx.recentHistory}\n</recent-history>`);
  }

  return sections.length > 0 ? sections.join("\n\n") : "";
}

// ─── Pipeline Registry ──────────────────────────────────────

/**
 * Derive a pipeline name from its filename.
 * Strips `.pipeline.yaml`, `.pipeline.yml`, `.yaml`, `.yml` extensions.
 */
export function pipelineNameFromFilename(filename: string): string {
  return filename
    .replace(/\.pipeline\.ya?ml$/, "")
    .replace(/\.ya?ml$/, "");
}

/**
 * Scan a directory for pipeline YAML files.
 */
function scanPipelinesDir(dir: string, origin: PipelineOrigin): PipelineEntry[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => ({
      name: pipelineNameFromFilename(f),
      origin,
      path: join(dir, f),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * List all available pipelines from both project and user levels.
 */
export function listAvailablePipelines(workingDir: string): PipelineEntry[] {
  const projectPipelines = scanPipelinesDir(
    join(getProjectDir(workingDir), "pipelines"),
    "project",
  );
  const userPipelines = scanPipelinesDir(
    join(GLOBAL_DIR, "pipelines"),
    "user",
  );

  return [...projectPipelines, ...userPipelines].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/**
 * Get the name of the currently active pipeline for a project.
 */
export function getActivePipelineName(workingDir: string): string | null {
  const path = join(getProjectDir(workingDir), "active-pipeline");
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf-8").trim();
  return content || null;
}

/**
 * Set the active pipeline for a project.
 */
export function setActivePipeline(workingDir: string, name: string): void {
  const projectDir = getProjectDir(workingDir);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "active-pipeline"), name);
}

/**
 * Find all entries for a pipeline name (detects conflicts across levels).
 */
export function findPipelineConflicts(workingDir: string, name: string): PipelineEntry[] {
  return listAvailablePipelines(workingDir).filter((e) => e.name === name);
}

/**
 * Resolve a pipeline name to its absolute path.
 * Returns the path, or null if not found.
 * If there's a conflict (same name in project and user), checks stored preferences.
 * Returns `{ path, conflict }` — conflict is true when there are two entries and no preference.
 */
export function resolvePipelinePath(
  workingDir: string,
  name: string,
): { path: string; origin: PipelineOrigin } | { conflict: PipelineEntry[] } | null {
  const entries = findPipelineConflicts(workingDir, name);

  if (entries.length === 0) return null;
  if (entries.length === 1) return { path: entries[0]!.path, origin: entries[0]!.origin };

  // Conflict — check preferences
  const preferred = getPipelineDefault(workingDir, name);
  if (preferred) {
    const match = entries.find((e) => e.origin === preferred);
    if (match) return { path: match.path, origin: match.origin };
  }

  return { conflict: entries };
}

// ─── User Preferences ───────────────────────────────────────

function preferencesPath(): string {
  return join(GLOBAL_DIR, "preferences.json");
}

/**
 * Load user preferences from ~/.openthk/preferences.json.
 */
export function loadUserPreferences(): UserPreferences {
  const path = preferencesPath();
  if (!existsSync(path)) return { pipelineDefaults: {} };

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      pipelineDefaults: parsed.pipelineDefaults ?? {},
    };
  } catch {
    return { pipelineDefaults: {} };
  }
}

/**
 * Save user preferences to ~/.openthk/preferences.json.
 */
export function saveUserPreferences(prefs: UserPreferences): void {
  mkdirSync(GLOBAL_DIR, { recursive: true });
  writeFileSync(preferencesPath(), JSON.stringify(prefs, null, 2), { mode: 0o600 });
}

/**
 * Get the stored pipeline default for a conflict (project vs user).
 */
export function getPipelineDefault(workingDir: string, name: string): PipelineOrigin | null {
  const prefs = loadUserPreferences();
  const key = `${workingDir}::${name}`;
  return prefs.pipelineDefaults[key] ?? null;
}

/**
 * Set the stored pipeline default for a conflict (project vs user).
 */
export function setPipelineDefault(workingDir: string, name: string, origin: PipelineOrigin): void {
  const prefs = loadUserPreferences();
  const key = `${workingDir}::${name}`;
  prefs.pipelineDefaults[key] = origin;
  saveUserPreferences(prefs);
}

/**
 * Clear the stored pipeline default for a conflict.
 */
export function clearPipelineDefault(workingDir: string, name: string): void {
  const prefs = loadUserPreferences();
  const key = `${workingDir}::${name}`;
  delete prefs.pipelineDefaults[key];
  saveUserPreferences(prefs);
}
