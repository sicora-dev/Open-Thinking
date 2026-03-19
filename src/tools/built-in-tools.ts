/**
 * Built-in tools for filesystem interaction and command execution.
 * These tools let LLMs read, write, search files and run commands
 * in the user's project directory.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { err, ok } from "../shared/result";
import type { ToolFunction } from "../shared/types";

const MAX_FILE_SIZE = 100 * 1024; // 100KB
const MAX_LIST_ENTRIES = 500;
const MAX_COMMAND_OUTPUT = 50 * 1024; // 50KB
const MAX_SEARCH_MATCHES = 100;
const DEFAULT_COMMAND_TIMEOUT = 30_000;

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

export function createReadFileTool(workingDir: string): ToolFunction {
  return {
    name: "read_file",
    description: "Read the contents of a file. Returns the file content as a string.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root" },
      },
      required: ["path"],
    },
    async execute(args) {
      const filePath = args.path as string;
      const resolved = safePath(workingDir, filePath);
      if (!resolved) return err(new Error(`Path traversal blocked: ${filePath}`));
      if (!existsSync(resolved)) return err(new Error(`File not found: ${filePath}`));

      const stat = statSync(resolved);
      if (stat.isDirectory()) return err(new Error(`Path is a directory: ${filePath}`));
      if (stat.size > MAX_FILE_SIZE) {
        const content = readFileSync(resolved, "utf-8").slice(0, MAX_FILE_SIZE);
        return ok(`${content}\n\n[... truncated, file is ${stat.size} bytes]`);
      }
      return ok(readFileSync(resolved, "utf-8"));
    },
  };
}

export function createWriteFileTool(workingDir: string): ToolFunction {
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
      const filePath = args.path as string;
      const content = args.content as string;
      const resolved = safePath(workingDir, filePath);
      if (!resolved) return err(new Error(`Path traversal blocked: ${filePath}`));

      mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, content);
      return ok(`Wrote ${content.length} bytes to ${filePath}`);
    },
  };
}

export function createListFilesTool(workingDir: string): ToolFunction {
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
      const dirPath = (args.path as string) ?? ".";
      const recursive = (args.recursive as boolean) ?? false;
      const resolved = safePath(workingDir, dirPath);
      if (!resolved) return err(new Error(`Path traversal blocked: ${dirPath}`));
      if (!existsSync(resolved)) return err(new Error(`Directory not found: ${dirPath}`));

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
      const suffix =
        entries.length >= MAX_LIST_ENTRIES
          ? `\n[... truncated at ${MAX_LIST_ENTRIES} entries]`
          : "";
      return ok(entries.join("\n") + suffix);
    },
  };
}

export function createRunCommandTool(workingDir: string): ToolFunction {
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
      const command = args.command as string;
      const timeout = (args.timeout_ms as number) ?? DEFAULT_COMMAND_TIMEOUT;

      try {
        const output = execSync(command, {
          cwd: workingDir,
          timeout,
          maxBuffer: MAX_COMMAND_OUTPUT,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return ok(output || "(no output)");
      } catch (e) {
        const execError = e as {
          stdout?: string;
          stderr?: string;
          status?: number;
          message: string;
        };
        const stdout = execError.stdout ?? "";
        const stderr = execError.stderr ?? "";
        const status = execError.status ?? 1;
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
      const pattern = args.pattern as string;
      const searchPath = (args.path as string) ?? ".";
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

function matchSimpleGlob(filename: string, glob: string): boolean {
  // Simple glob: *.ts matches foo.ts, *.{ts,tsx} matches foo.ts or foo.tsx
  const pattern = glob
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\{([^}]+)\}/g, (_, alts: string) => `(${alts.split(",").join("|")})`);
  return new RegExp(`^${pattern}$`).test(filename);
}
