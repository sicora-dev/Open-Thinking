import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  getGlobalSkillsDir,
  getProjectSkillsDir,
} from "../../skills/catalog";

export { getGlobalSkillsDir, getProjectSkillsDir } from "../../skills/catalog";

export type SkillScope = "global" | "project";

export type SkillEntry = {
  id: string;
  namespace: string;
  name: string;
  path: string;
  scope: SkillScope;
  projectId: string | null;
};

export type SkillDocument = {
  prompt: string;
  manifest: string;
};

function normalizePathPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function isInsideRoot(targetPath: string, rootPath: string): boolean {
  const rel = relative(resolve(rootPath), resolve(targetPath));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function createDefaultManifest(namespace: string, name: string): string {
  return `name: ${name}
version: "1.0"
description: ${namespace}/${name} skill

context:
  reads: ["input.*"]
  writes: ["${name}.*"]

allowed_tools:
  - read_file
  - list_files
`;
}

function createDefaultPrompt(namespace: string, name: string): string {
  return `# ${namespace}/${name}

Describe what this skill should do here.
`;
}

export function listSkillsInRoot(
  rootPath: string,
  scope: SkillScope,
  projectId: string | null = null,
): SkillEntry[] {
  if (!existsSync(rootPath)) return [];

  const out: SkillEntry[] = [];
  try {
    const namespaces = readdirSync(rootPath, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    for (const namespace of namespaces) {
      const namespacePath = join(rootPath, namespace.name);
      const skills = readdirSync(namespacePath, { withFileTypes: true }).filter((entry) => entry.isDirectory());
      for (const skill of skills) {
        out.push({
          id: `${namespace.name}/${skill.name}`,
          namespace: namespace.name,
          name: skill.name,
          path: join(namespacePath, skill.name),
          scope,
          projectId,
        });
      }
    }
  } catch {
    return [];
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function createSkillInRoot(input: {
  rootPath: string;
  namespace: string;
  name: string;
  prompt?: string;
  manifest?: string;
  overwrite?: boolean;
}): SkillEntry {
  const namespace = normalizePathPart(input.namespace) || "custom";
  const name = normalizePathPart(input.name) || "new-skill";
  const skillPath = join(input.rootPath, namespace, name);

  if (existsSync(skillPath) && !input.overwrite) {
    throw new Error(`Skill already exists: ${skillPath}`);
  }

  mkdirSync(skillPath, { recursive: true });
  writeFileSync(join(skillPath, "prompt.md"), input.prompt ?? createDefaultPrompt(namespace, name), "utf-8");
  writeFileSync(
    join(skillPath, "skill.yaml"),
    input.manifest ?? createDefaultManifest(namespace, name),
    "utf-8",
  );

  return {
    id: `${namespace}/${name}`,
    namespace,
    name,
    path: skillPath,
    scope: "global",
    projectId: null,
  };
}

export function readSkillDocument(skillPath: string, allowedRoots: string[]): SkillDocument {
  const abs = resolve(skillPath);
  if (!allowedRoots.some((root) => isInsideRoot(abs, root))) {
    throw new Error(`Skill path is outside allowed roots: ${abs}`);
  }
  return {
    prompt: existsSync(join(abs, "prompt.md")) ? readFileSync(join(abs, "prompt.md"), "utf-8") : "",
    manifest: existsSync(join(abs, "skill.yaml")) ? readFileSync(join(abs, "skill.yaml"), "utf-8") : "",
  };
}

export function saveSkillDocument(input: {
  path: string;
  prompt: string;
  manifest: string;
  allowedRoots: string[];
}): void {
  const abs = resolve(input.path);
  if (!input.allowedRoots.some((root) => isInsideRoot(abs, root))) {
    throw new Error(`Skill path is outside allowed roots: ${abs}`);
  }
  mkdirSync(abs, { recursive: true });
  writeFileSync(join(abs, "prompt.md"), input.prompt, "utf-8");
  writeFileSync(join(abs, "skill.yaml"), input.manifest, "utf-8");
}

export function deleteSkillDocument(skillPath: string, allowedRoots: string[]): void {
  const abs = resolve(skillPath);
  if (!allowedRoots.some((root) => isInsideRoot(abs, root))) {
    throw new Error(`Skill path is outside allowed roots: ${abs}`);
  }
  if (!existsSync(abs)) {
    throw new Error(`Skill does not exist: ${abs}`);
  }
  rmSync(abs, { recursive: true, force: true });

  let current = dirname(abs);
  for (let i = 0; i < 2; i++) {
    if (!existsSync(current)) break;
    try {
      if (readdirSync(current).length === 0) {
        rmSync(current, { recursive: true, force: true });
      }
    } catch {
      break;
    }
    current = dirname(current);
  }
}
