import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { getOpenthkConfigDir } from "../config/paths";
import { EMBEDDED_BUILT_IN_SKILLS, listEmbeddedBuiltInSkills } from "./built-in-skills";

export type LoadedSkill = {
  prompt: string | null;
  allowedTools: string[] | null;
  path: string | null;
};

export function getGlobalSkillsDir(): string {
  return join(getOpenthkConfigDir(), "skills");
}

export function getProjectSkillsDir(projectPath: string): string {
  return join(projectPath, ".openthk", "pipelines", "skills");
}

function getBuiltInSkillsDirCandidates(): string[] {
  const sourceRelative = fileURLToPath(new URL("../../examples/skills", import.meta.url));
  const execRelative = resolve(dirname(process.execPath), "..", "examples", "skills");
  const cwdRelative = resolve(process.cwd(), "examples", "skills");
  return [...new Set([sourceRelative, execRelative, cwdRelative])];
}

export function getBuiltInSkillsDir(): string {
  return getBuiltInSkillsDirCandidates().find(existsSync) ?? getBuiltInSkillsDirCandidates()[0]!;
}

export function getSkillSearchDirs(skillsDir?: string | string[]): string[] {
  const configured = Array.isArray(skillsDir)
    ? skillsDir
    : skillsDir
      ? [skillsDir]
      : [];
  const roots = [...configured, getGlobalSkillsDir(), getBuiltInSkillsDir()];
  return [...new Set(roots.filter(Boolean))];
}

function resolveSkillDir(skillRef: string, rootPath: string): string {
  const withoutVersion = skillRef.split("@")[0] ?? skillRef;
  const parts = withoutVersion.split("/");
  const first = parts[0] ?? withoutVersion;
  return parts.length >= 2
    ? join(rootPath, first, parts.slice(1).join("/"))
    : join(rootPath, first);
}

function normalizeSkillRef(skillRef: string): string {
  return skillRef.split("@")[0] ?? skillRef;
}

export function listBuiltInSkillRefs(): string[] {
  return listEmbeddedBuiltInSkills();
}

export function loadSkillDefinition(
  skillRef: string,
  skillsDir?: string | string[],
): LoadedSkill {
  for (const rootPath of getSkillSearchDirs(skillsDir)) {
    const skillPath = resolveSkillDir(skillRef, rootPath);
    const promptPath = join(skillPath, "prompt.md");
    const manifestPath = join(skillPath, "skill.yaml");

    if (!existsSync(promptPath) && !existsSync(manifestPath)) {
      continue;
    }

    const prompt = existsSync(promptPath) ? readFileSync(promptPath, "utf-8").trim() : null;
    let allowedTools: string[] | null = null;
    if (existsSync(manifestPath)) {
      try {
        const raw = parseYaml(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
        if (Array.isArray(raw.allowed_tools)) {
          allowedTools = raw.allowed_tools as string[];
        }
      } catch {
        // Ignore malformed manifests and fall back to runtime defaults.
      }
    }

    return { prompt, allowedTools, path: skillPath };
  }

  const embedded = EMBEDDED_BUILT_IN_SKILLS[normalizeSkillRef(skillRef)];
  if (embedded) {
    const builtInRoot = getBuiltInSkillsDirCandidates().find(existsSync) ?? null;
    return {
      prompt: embedded.prompt,
      allowedTools: embedded.allowedTools,
      path: builtInRoot ? resolveSkillDir(skillRef, builtInRoot) : null,
    };
  }

  return { prompt: null, allowedTools: null, path: null };
}
