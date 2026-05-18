/**
 * Sandbox-aware tool wrappers.
 *
 * Wraps the standard built-in tools so that:
 * - read_file falls through to real FS but checks sandbox first
 * - write_file redirects to the sandbox directory
 * - list_files merges sandbox overlay with real FS
 * - run_command executes in the sandbox with project files symlinked
 * - search_files searches both real and sandbox files
 * - get_context is unaffected (context store is shared)
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { err, ok } from "../../shared/result";
import type { ToolFunction } from "../../shared/types";
import { filterCommandOutput } from "../../tools/output-filters";
import type { Sandbox } from "./sandbox-manager";

const MAX_FILE_SIZE = 32 * 1024;
const MAX_COMMAND_OUTPUT = 50 * 1024;
const DEFAULT_COMMAND_TIMEOUT = 30_000;
const READ_FILE_MAX_LINES = 1500;

function safePath(workingDir: string, filePath: string): string | null {
  const resolved = resolve(workingDir, filePath);
  const rel = relative(workingDir, resolved);
  if (rel.startsWith("..") || resolve(workingDir, rel) !== resolved) {
    return null;
  }
  return resolved;
}

export function createSandboxReadFileTool(
  workingDir: string,
  sandbox: Sandbox,
): ToolFunction {
  return {
    name: "read_file",
    description:
      "Read the contents of a file. In sandbox mode, reads from sandbox overlay if the file was modified, otherwise from the real filesystem.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root" },
        offset: { type: "number", description: "1-indexed line number to start from. Default: 1." },
        limit: { type: "number", description: `Max lines to return. Default/max: ${READ_FILE_MAX_LINES}.` },
      },
      required: ["path"],
    },
    async execute(args) {
      const filePath = args.path;
      if (typeof filePath !== "string" || filePath.trim().length === 0) {
        return err(new Error("read_file requires a non-empty string 'path'"));
      }
      const offset = typeof args.offset === "number" ? Math.max(1, Math.floor(args.offset)) : 1;
      const limit = Math.min(
        Math.max(1, typeof args.limit === "number" ? Math.floor(args.limit) : READ_FILE_MAX_LINES),
        READ_FILE_MAX_LINES,
      );

      // Validate relative path
      const checked = safePath(workingDir, filePath);
      if (!checked) return err(new Error(`Path traversal blocked: ${filePath}`));

      const rel = relative(workingDir, checked);

      // Resolve through sandbox (sandbox overlay takes priority)
      let resolvedPath: string;
      try {
        resolvedPath = sandbox.resolveReadPath(rel);
      } catch (e) {
        return err(new Error((e as Error).message));
      }

      if (!existsSync(resolvedPath)) return err(new Error(`File not found: ${filePath}`));

      const stat = statSync(resolvedPath);
      if (stat.isDirectory()) return err(new Error(`Path is a directory: ${filePath}`));

      let raw: string;
      try {
        raw = readFileSync(resolvedPath, "utf-8");
      } catch (e) {
        return err(new Error(`Failed to read ${filePath}: ${(e as Error).message}`));
      }

      const lines = raw.split("\n");
      const totalLines = lines.length;
      const startIdx = offset - 1;
      const endIdx = Math.min(startIdx + limit, totalLines);
      let body = lines.slice(startIdx, endIdx).join("\n");

      let byteTruncated = false;
      if (new TextEncoder().encode(body).length > MAX_FILE_SIZE) {
        body = body.slice(0, MAX_FILE_SIZE);
        byteTruncated = true;
      }

      const notes: string[] = [];
      if (offset > 1 || endIdx < totalLines) {
        notes.push(`Showing lines ${offset}-${endIdx} of ${totalLines}.`);
      }
      if (byteTruncated) {
        notes.push(`Output truncated at ${MAX_FILE_SIZE / 1024}KB.`);
      }

      return ok(notes.length > 0 ? `${body}\n\n[${notes.join(" ")}]` : body);
    },
  };
}

export function createSandboxWriteFileTool(
  workingDir: string,
  sandbox: Sandbox,
): ToolFunction {
  return {
    name: "write_file",
    description:
      "Write content to a file (sandboxed). Changes are staged in an isolated directory and can be reviewed before applying.",
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
      const checked = safePath(workingDir, filePath);
      if (!checked) return err(new Error(`Path traversal blocked: ${filePath}`));

      const rel = relative(workingDir, checked);
      const sandboxPath = sandbox.resolveWritePath(rel);
      writeFileSync(sandboxPath, content);
      return ok(`[sandbox] Wrote ${content.length} bytes to ${filePath}`);
    },
  };
}

export function createSandboxListFilesTool(
  workingDir: string,
  sandbox: Sandbox,
): ToolFunction {
  return {
    name: "list_files",
    description: "List files and directories. Merges real filesystem with sandbox overlay.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to project root (default: '.')" },
        recursive: { type: "boolean", description: "List files recursively (default: false)" },
      },
    },
    async execute(args) {
      const pathArg = args.path;
      if (pathArg !== undefined && typeof pathArg !== "string") {
        return err(new Error("list_files expects 'path' to be a string"));
      }
      const dirPath = (pathArg as string) ?? ".";
      const recursive = (args.recursive as boolean) ?? false;

      const checked = safePath(workingDir, dirPath);
      if (!checked) return err(new Error(`Path traversal blocked: ${dirPath}`));

      const entries = new Set<string>();
      const MAX_ENTRIES = 500;

      // Walk real filesystem
      function walkReal(dir: string): void {
        if (entries.size >= MAX_ENTRIES || !existsSync(dir)) return;
        for (const item of readdirSync(dir)) {
          if (entries.size >= MAX_ENTRIES) break;
          if (item === "node_modules" || item === ".git") continue;
          const full = join(dir, item);
          const rel = relative(workingDir, full);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            entries.add(`${rel}/`);
            if (recursive) walkReal(full);
          } else {
            // Skip if deleted in sandbox
            if (!sandbox.state().deletedFiles.has(rel)) {
              entries.add(rel);
            }
          }
        }
      }

      // Walk sandbox overlay
      const sandboxDir = sandbox.state().sandboxDir;
      const sandboxSubdir = join(sandboxDir, relative(workingDir, checked));
      function walkSandbox(dir: string): void {
        if (entries.size >= MAX_ENTRIES || !existsSync(dir)) return;
        for (const item of readdirSync(dir)) {
          if (entries.size >= MAX_ENTRIES) break;
          const full = join(dir, item);
          const rel = relative(sandboxDir, full);
          const stat = statSync(full);
          if (stat.isDirectory()) {
            entries.add(`${rel}/`);
            if (recursive) walkSandbox(full);
          } else {
            entries.add(rel);
          }
        }
      }

      walkReal(checked);
      walkSandbox(sandboxSubdir);

      const sorted = [...entries].sort();
      if (sorted.length === 0) return ok("(empty directory)");
      const suffix = sorted.length >= MAX_ENTRIES ? `\n[... truncated at ${MAX_ENTRIES} entries]` : "";
      return ok(sorted.join("\n") + suffix);
    },
  };
}

export function createSandboxRunCommandTool(
  workingDir: string,
  sandbox: Sandbox,
): ToolFunction {
  return {
    name: "run_command",
    description:
      "Execute a shell command in sandbox mode. The command runs in the sandbox directory. " +
      "File changes from the command are captured in the sandbox.",
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

      sandbox.recordCommand(command);

      // Prepare the sandbox command dir: ensure it has essential project
      // structure by symlinking key directories that commands may need.
      prepareSandboxForCommand(workingDir, sandbox);

      try {
        const output = execSync(command, {
          cwd: sandbox.commandWorkingDir(),
          timeout,
          maxBuffer: MAX_COMMAND_OUTPUT,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
          env: {
            ...process.env,
            // Tell the command it's in a sandbox
            OPENTHK_SANDBOX: "1",
            OPENTHK_SANDBOX_DIR: sandbox.state().sandboxDir,
            OPENTHK_PROJECT_DIR: workingDir,
          },
        });
        const filtered = filterCommandOutput(command, output);
        return ok(`[sandbox] ${filtered || "(no output)"}`);
      } catch (e) {
        const execError = e as { stdout?: string; stderr?: string; status?: number; message: string };
        const stdout = filterCommandOutput(command, execError.stdout ?? "");
        const stderr = filterCommandOutput(command, execError.stderr ?? "");
        const status = execError.status ?? 1;
        return ok(`[sandbox] Exit code: ${status}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`);
      }
    },
  };
}

/**
 * Prepare the sandbox directory for command execution by creating
 * symlinks to key project directories that aren't being modified.
 * This lets commands like `npm test` find their dependencies.
 */
function prepareSandboxForCommand(workingDir: string, sandbox: Sandbox): void {
  const sandboxDir = sandbox.state().sandboxDir;
  const dirsToLink = ["node_modules", ".git", "package.json", "tsconfig.json", "bun.lockb"];

  for (const name of dirsToLink) {
    const source = join(workingDir, name);
    const target = join(sandboxDir, name);
    if (existsSync(source) && !existsSync(target)) {
      try {
        symlinkSync(source, target);
      } catch {
        // Skip if symlink fails (e.g., file already exists)
      }
    }
  }
}
