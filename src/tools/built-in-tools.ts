/**
 * Built-in tools for filesystem interaction and command execution.
 * These tools let LLMs read, write, search files and run commands
 * in the user's project directory.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { PolicyEngine } from "../policies/engine";
import { err, ok } from "../shared/result";
import type {
  ContextStore,
  StageContextPermissions,
  ToolFunction,
} from "../shared/types";
import { filterCommandOutput } from "./output-filters";

/**
 * Lower than the previous 100KB cap. Most useful files (source code,
 * config) fit easily in 32KB; for anything larger, the agent should
 * use the offset/limit parameters to page through.
 */
const MAX_FILE_SIZE = 32 * 1024; // 32KB
const MAX_LIST_ENTRIES = 500;
const MAX_COMMAND_OUTPUT = 50 * 1024; // 50KB
const MAX_SEARCH_MATCHES = 100;
const DEFAULT_COMMAND_TIMEOUT = 30_000;
/** Hard cap on lines returned by a single read_file call. */
const READ_FILE_MAX_LINES = 1500;

/**
 * Validate that a resolved path is within the working directory.
 */
function safePath(workingDir: string, filePath: string): string | null {
  const resolved = resolve(workingDir, filePath);
  const rel = relative(workingDir, resolved);
  if (rel.startsWith("..") || resolve(workingDir, rel) !== resolved) {
    return null;
  }
  return resolved;
}

function commandHasWorkspaceEscape(command: string): string | null {
  if (/(^|[\s"'`])\.\.(\/|\\)/.test(command)) {
    return "Command references a parent directory path ('../'), which is outside the workspace boundary";
  }
  if (/(^|\s)(>|>>|2>|&>)\s*['"]?\//.test(command)) {
    return "Command redirects output to an absolute path outside the workspace boundary";
  }
  return null;
}

/**
 * Per-stage cache for `read_file`. Keyed by absolute path, stores the
 * file's mtime (ms) and the content already shown to the agent.
 *
 * If the agent re-reads an unchanged file in the same stage, we
 * return a one-line acknowledgement instead of the full body — saving
 * a round-trip's worth of tokens. The agent has the content in its
 * working memory already (as the previous tool result).
 */
type ReadCacheEntry = { mtimeMs: number; size: number };

export type ToolSessionState = {
  fsEpoch: number;
};

export function createReadFileTool(
  workingDir: string,
  session: ToolSessionState = { fsEpoch: 0 },
): ToolFunction {
  // Cache lifetime = lifetime of this tool function = one stage run.
  const sessionCache = new Map<string, ReadCacheEntry>();

  return {
    name: "read_file",
    description:
      "Read the contents of a file. Supports paging via offset/limit (1-indexed line numbers). " +
      "If you call this twice on an unchanged file in the same stage, you'll get a 'cached' marker — " +
      "the previous content is already in your working memory. " +
      `Files over ${MAX_FILE_SIZE / 1024}KB or ${READ_FILE_MAX_LINES} lines must be paged with offset/limit.`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root" },
        offset: {
          type: "number",
          description:
            "1-indexed line number to start reading from. Default: 1 (start of file).",
        },
        limit: {
          type: "number",
          description: `Maximum number of lines to return. Default and max: ${READ_FILE_MAX_LINES}.`,
        },
      },
      required: ["path"],
    },
    async execute(args) {
      const filePath = args.path;
      if (typeof filePath !== "string" || filePath.trim().length === 0) {
        return err(new Error("read_file requires a non-empty string 'path'"));
      }
      const offset = typeof args.offset === "number" ? Math.max(1, Math.floor(args.offset)) : 1;
      const limitArg =
        typeof args.limit === "number" ? Math.floor(args.limit) : READ_FILE_MAX_LINES;
      const limit = Math.min(Math.max(1, limitArg), READ_FILE_MAX_LINES);

      const resolved = safePath(workingDir, filePath);
      if (!resolved) return err(new Error(`Path traversal blocked: ${filePath}`));
      if (!existsSync(resolved)) return err(new Error(`File not found: ${filePath}`));

      const stat = statSync(resolved);
      if (stat.isDirectory()) return err(new Error(`Path is a directory: ${filePath}`));

      const cacheKey = `${resolved}:${offset}:${limit}:${session.fsEpoch}`;
      const cached = sessionCache.get(cacheKey);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return ok(
          `[cached: ${filePath} unchanged since the previous read in this stage. ` +
            "The content is in your working memory — do not re-process it.]",
        );
      }

      let raw: string;
      try {
        raw = readFileSync(resolved, "utf-8");
      } catch (e) {
        return err(new Error(`Failed to read ${filePath}: ${(e as Error).message}`));
      }

      const lines = raw.split("\n");
      const totalLines = lines.length;

      // Slice with offset/limit
      const startIdx = offset - 1;
      const endIdx = Math.min(startIdx + limit, totalLines);
      const slice = lines.slice(startIdx, endIdx).join("\n");

      // Apply byte cap as a hard secondary safety net.
      let body = slice;
      let byteTruncated = false;
      if (new TextEncoder().encode(body).length > MAX_FILE_SIZE) {
        body = body.slice(0, MAX_FILE_SIZE);
        byteTruncated = true;
      }

      const notes: string[] = [];
      if (offset > 1 || endIdx < totalLines) {
        notes.push(
          `Showing lines ${offset}–${endIdx} of ${totalLines}. ` +
            (endIdx < totalLines
              ? `Use offset=${endIdx + 1} for the next page.`
              : "End of file."),
        );
      }
      if (byteTruncated) {
        notes.push(
          `Output truncated at ${MAX_FILE_SIZE / 1024}KB. Use a smaller limit to page.`,
        );
      }

      sessionCache.set(cacheKey, { mtimeMs: stat.mtimeMs, size: stat.size });

      return ok(notes.length > 0 ? `${body}\n\n[${notes.join(" ")}]` : body);
    },
  };
}

export function createWriteFileTool(
  workingDir: string,
  session: ToolSessionState = { fsEpoch: 0 },
): ToolFunction {
  return {
    name: "write_file",
    description:
      "Write content to a file. Creates the file and parent directories if they don't exist. Overwrites existing files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
    async execute(args) {
      const filePath = args.path;
      if (typeof filePath !== "string" || filePath.trim().length === 0) {
        return err(new Error("write_file requires a non-empty string 'path'"));
      }
      const content = args.content;
      if (typeof content !== "string") {
        return err(new Error("write_file requires a string 'content'"));
      }
      const resolved = safePath(workingDir, filePath);
      if (!resolved) return err(new Error(`Path traversal blocked: ${filePath}`));

      mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, content);
      session.fsEpoch += 1;
      return ok(`Wrote ${content.length} bytes to ${filePath}`);
    },
  };
}

export function createListFilesTool(
  workingDir: string,
  session: ToolSessionState = { fsEpoch: 0 },
): ToolFunction {
  const sessionCache = new Set<string>();
  return {
    name: "list_files",
    description: "List files and directories. Returns a newline-separated list of paths.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path relative to project root (default: '.')",
        },
        recursive: { type: "boolean", description: "List files recursively (default: false)" },
      },
    },
    async execute(args) {
      const pathArg = args.path;
      if (pathArg !== undefined && typeof pathArg !== "string") {
        return err(new Error("list_files expects 'path' to be a string when provided"));
      }
      const dirPath = pathArg ?? ".";
      const recursive = (args.recursive as boolean) ?? false;
      const resolved = safePath(workingDir, dirPath);
      if (!resolved) return err(new Error(`Path traversal blocked: ${dirPath}`));
      if (!existsSync(resolved)) return err(new Error(`Directory not found: ${dirPath}`));

      const cacheKey = `${resolved}:${recursive}:${session.fsEpoch}`;
      if (sessionCache.has(cacheKey)) {
        return ok(
          `[cached: list_files(${dirPath}${recursive ? ", recursive=true" : ""}) unchanged since the previous call in this stage. ` +
            "The directory listing is already in your working memory.]",
        );
      }

      const entries: string[] = [];

      function walk(dir: string) {
        if (entries.length >= MAX_LIST_ENTRIES) return;
        const items = readdirSync(dir);
        for (const item of items) {
          if (entries.length >= MAX_LIST_ENTRIES) break;
          if (item === "node_modules" || item === ".git") continue;
          const full = join(dir, item);
          const rel = relative(workingDir, full);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            entries.push(`${rel}/`);
            if (recursive) walk(full);
          } else {
            entries.push(rel);
          }
        }
      }

      walk(resolved);

      // Token-efficient grouping: when there are too many entries to
      // fit comfortably in a prompt, collapse them into a per-directory
      // summary with file counts. The agent can drill down with a
      // narrower path argument if it actually needs the leaf names.
      if (entries.length > GROUPING_THRESHOLD) {
        sessionCache.add(cacheKey);
        return ok(formatGroupedListing(entries, entries.length >= MAX_LIST_ENTRIES));
      }

      const suffix =
        entries.length >= MAX_LIST_ENTRIES
          ? `\n[... truncated at ${MAX_LIST_ENTRIES} entries]`
          : "";
      sessionCache.add(cacheKey);
      return ok(entries.join("\n") + suffix);
    },
  };
}

/** Threshold above which `list_files` switches to grouped output. */
const GROUPING_THRESHOLD = 100;

/**
 * Group a flat path listing by parent directory and emit a per-dir
 * summary with counts. Always lists subdirectories explicitly so the
 * agent can recurse into them.
 */
function formatGroupedListing(entries: string[], wasTruncated: boolean): string {
  type Group = { dirs: Set<string>; files: number };
  const byParent = new Map<string, Group>();

  for (const entry of entries) {
    const isDir = entry.endsWith("/");
    const trimmed = isDir ? entry.slice(0, -1) : entry;
    const slash = trimmed.lastIndexOf("/");
    const parent = slash === -1 ? "." : trimmed.slice(0, slash);

    let group = byParent.get(parent);
    if (!group) {
      group = { dirs: new Set(), files: 0 };
      byParent.set(parent, group);
    }

    if (isDir) {
      group.dirs.add(`${trimmed.slice(slash + 1)}/`);
    } else {
      group.files++;
    }
  }

  const lines: string[] = [
    `[grouped view: ${entries.length} entries across ${byParent.size} directories. ` +
      "Call list_files with a more specific path to see leaf filenames.]",
    "",
  ];

  const sortedParents = [...byParent.keys()].sort();
  for (const parent of sortedParents) {
    const group = byParent.get(parent);
    if (!group) continue;
    const fileLabel = group.files === 1 ? "1 file" : `${group.files} files`;
    lines.push(`${parent}/  (${fileLabel})`);
    if (group.dirs.size > 0) {
      const sortedDirs = [...group.dirs].sort();
      for (const dir of sortedDirs) {
        lines.push(`  ${dir}`);
      }
    }
  }

  if (wasTruncated) {
    lines.push("", `[... truncated at ${MAX_LIST_ENTRIES} entries]`);
  }

  return lines.join("\n");
}

export function createRunCommandTool(
  workingDir: string,
  session: ToolSessionState = { fsEpoch: 0 },
): ToolFunction {
  return {
    name: "run_command",
    description:
      "Execute a shell command in the project directory. Returns stdout and stderr. Use for running tests, installing packages, builds, etc.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        timeout_ms: { type: "number", description: "Timeout in milliseconds (default: 30000)" },
      },
      required: ["command"],
    },
    async execute(args) {
      const command = args.command;
      if (typeof command !== "string" || command.trim().length === 0) {
        return err(new Error("run_command requires a non-empty string 'command'"));
      }
      const timeout = (args.timeout_ms as number) ?? DEFAULT_COMMAND_TIMEOUT;
      const escapeReason = commandHasWorkspaceEscape(command);
      if (escapeReason) return err(new Error(escapeReason));

      try {
        const output = execSync(command, {
          cwd: workingDir,
          timeout,
          maxBuffer: MAX_COMMAND_OUTPUT,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
        });
        const filtered = filterCommandOutput(command, output);
        session.fsEpoch += 1;
        return ok(filtered || "(no output)");
      } catch (e) {
        const execError = e as {
          stdout?: string;
          stderr?: string;
          status?: number;
          message: string;
        };
        const stdout = filterCommandOutput(command, execError.stdout ?? "");
        // Only ANSI-strip stderr — error messages should pass through
        // largely unfiltered so the agent can react to them.
        const stderr = filterCommandOutput(command, execError.stderr ?? "");
        const status = execError.status ?? 1;
        session.fsEpoch += 1;
        return ok(`Exit code: ${status}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`);
      }
    },
  };
}

export function createSearchFilesTool(workingDir: string): ToolFunction {
  return {
    name: "search_files",
    description:
      "Search for a regex pattern in files. Returns matching lines with file paths and line numbers.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        path: { type: "string", description: "Directory to search in (default: '.')" },
        glob: { type: "string", description: "File glob pattern to filter (e.g., '*.ts')" },
      },
      required: ["pattern"],
    },
    async execute(args) {
      const pattern = args.pattern;
      if (typeof pattern !== "string" || pattern.trim().length === 0) {
        return err(new Error("search_files requires a non-empty string 'pattern'"));
      }
      const pathArg = args.path;
      if (pathArg !== undefined && typeof pathArg !== "string") {
        return err(new Error("search_files expects 'path' to be a string when provided"));
      }
      const searchPath = pathArg ?? ".";
      const globFilter = args.glob as string | undefined;
      const resolved = safePath(workingDir, searchPath);
      if (!resolved) return err(new Error(`Path traversal blocked: ${searchPath}`));

      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch {
        return err(new Error(`Invalid regex: ${pattern}`));
      }

      const matches: string[] = [];

      function searchDir(dir: string) {
        if (matches.length >= MAX_SEARCH_MATCHES) return;
        const items = readdirSync(dir);
        for (const item of items) {
          if (matches.length >= MAX_SEARCH_MATCHES) break;
          if (item === "node_modules" || item === ".git") continue;
          const full = join(dir, item);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            searchDir(full);
          } else {
            if (globFilter && !matchSimpleGlob(item, globFilter)) continue;
            if (stat.size > MAX_FILE_SIZE) continue;
            try {
              const content = readFileSync(full, "utf-8");
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (matches.length >= MAX_SEARCH_MATCHES) break;
                const line = lines[i];
                if (line !== undefined && regex.test(line)) {
                  const rel = relative(workingDir, full);
                  matches.push(`${rel}:${i + 1}: ${line}`);
                }
              }
            } catch {
              // Skip binary/unreadable files
            }
          }
        }
      }

      searchDir(resolved);
      if (matches.length === 0) return ok("No matches found.");
      const suffix =
        matches.length >= MAX_SEARCH_MATCHES
          ? `\n[... truncated at ${MAX_SEARCH_MATCHES} matches]`
          : "";
      return ok(matches.join("\n") + suffix);
    },
  };
}

/**
 * `get_context` tool — fetches a single context store entry on demand.
 *
 * This tool is the cornerstone of lazy context loading: instead of inlining
 * the full context payload into every system prompt, the agent receives
 * only an *index* and uses this tool to pull values it actually needs.
 * It saves a large fraction of tokens for stages with broad read globs.
 *
 * Access control: every read goes through the policy engine. The agent
 * cannot fetch keys outside of its declared `context.read` permissions.
 */
export function createGetContextTool(
  contextStore: ContextStore,
  permissions: StageContextPermissions,
  policyEngine: PolicyEngine,
  stageName: string,
): ToolFunction {
  const sessionCache = new Map<string, string>();
  return {
    name: "get_context",
    description:
      "Fetch the full value of a single context store entry by key. " +
      "Use this to access the body of large context entries that the system prompt only listed in the index. " +
      "Returns an error if the key is missing or outside your read permissions.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "The context key to fetch (e.g. 'planner.output'). Must match a key from the available-context-keys index.",
        },
      },
      required: ["key"],
    },
    async execute(args) {
      const key = args.key;
      if (typeof key !== "string" || !key) {
        return err(new Error("get_context requires a non-empty 'key' argument"));
      }

      // Enforce read policy before touching the store.
      // Exception: `persistent.*` keys are project-wide metadata seeded
      // by the executor (learned notes, history). They are always
      // readable — they exist precisely because the system prompt
      // doesn't inline them anymore.
      if (!key.startsWith("persistent.")) {
        const access = policyEngine.checkRead(stageName, permissions, key);
        if (!access.ok) return err(access.error);
      }

      const result = await contextStore.get(key);
      if (!result.ok) return err(result.error);
      if (!result.value) return err(new Error(`Context key not found: ${key}`));
      const cachedValue = sessionCache.get(key);
      if (cachedValue !== undefined && cachedValue === result.value.value) {
        return ok(
          `[cached: context key "${key}" unchanged since the previous fetch in this stage. ` +
            "The value is already in your working memory.]",
        );
      }
      sessionCache.set(key, result.value.value);
      return ok(result.value.value);
    },
  };
}

function matchSimpleGlob(filename: string, glob: string): boolean {
  // Simple glob: *.ts matches foo.ts, *.{ts,tsx} matches foo.ts or foo.tsx
  const pattern = glob
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\{([^}]+)\}/g, (_, alts: string) => `(${alts.split(",").join("|")})`);
  return new RegExp(`^${pattern}$`).test(filename);
}
