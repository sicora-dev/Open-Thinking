/**
 * Sandbox manager: creates isolated environments for pipeline stages.
 *
 * When `permissions: sandbox` is active, tool operations (file writes,
 * commands) happen in a temporary directory. After execution completes,
 * the user reviews a diff and decides to apply or discard.
 *
 * Design:
 * - Reads fall through to the real filesystem (sandbox overlay takes priority)
 * - Writes go to `<sandboxDir>/<relativePath>` mirroring the project structure
 * - Commands execute with cwd set to the sandbox directory
 * - Diff is computed by comparing sandbox files against originals
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { type Result, err, ok } from "../../shared/result";

export type SandboxFileDiff = {
  path: string;
  status: "added" | "modified" | "deleted";
  /** Original content (null for new files). */
  original: string | null;
  /** New content (null for deleted files). */
  modified: string | null;
};

export type SandboxState = {
  /** Unique sandbox ID. */
  id: string;
  /** Path to the sandbox root directory. */
  sandboxDir: string;
  /** Original project working directory. */
  workingDir: string;
  /** Files that were written or modified in the sandbox. */
  writtenFiles: Set<string>;
  /** Files that were deleted in the sandbox (marked with a tombstone). */
  deletedFiles: Set<string>;
  /** Commands that were run inside the sandbox. */
  commandsRun: string[];
  /** Whether the sandbox has been finalized (applied or discarded). */
  finalized: boolean;
};

export type Sandbox = {
  /** Get the sandbox state. */
  state(): SandboxState;

  /**
   * Resolve a file path: returns the sandbox path if the file was
   * written there, otherwise falls through to the real path.
   */
  resolveReadPath(relativePath: string): string;

  /** Get the sandbox path for writing (creates parent dirs). */
  resolveWritePath(relativePath: string): string;

  /** Mark a file as deleted in the sandbox. */
  markDeleted(relativePath: string): void;

  /** Get the effective working directory for commands. */
  commandWorkingDir(): string;

  /** Record a command that was run. */
  recordCommand(command: string): void;

  /** Compute diffs between sandbox and original files. */
  diff(): SandboxFileDiff[];

  /** Format diff for human review (unified diff format). */
  formatDiff(): string;

  /** Apply sandbox changes to the real filesystem. */
  apply(): Result<{ applied: number }>;

  /** Discard the sandbox (delete temp directory). */
  discard(): void;
};

const TOMBSTONE_MARKER = "__SANDBOX_DELETED__";

export function createSandbox(workingDir: string, id?: string): Sandbox {
  const sandboxId = id ?? crypto.randomUUID().slice(0, 8);
  const sandboxDir = mkdtempSync(join(tmpdir(), `openthk-sandbox-${sandboxId}-`));

  const state: SandboxState = {
    id: sandboxId,
    sandboxDir,
    workingDir: resolve(workingDir),
    writtenFiles: new Set(),
    deletedFiles: new Set(),
    commandsRun: [],
    finalized: false,
  };

  function resolveReadPath(relativePath: string): string {
    const sandboxPath = join(sandboxDir, relativePath);
    // If file exists in sandbox and is not a tombstone, use sandbox version
    if (existsSync(sandboxPath)) {
      try {
        const content = readFileSync(sandboxPath, "utf-8");
        if (content === TOMBSTONE_MARKER) {
          // File was deleted in sandbox — don't fall through
          throw new Error(`File deleted in sandbox: ${relativePath}`);
        }
      } catch (e) {
        if ((e as Error).message.includes("deleted in sandbox")) throw e;
      }
      return sandboxPath;
    }
    // Fall through to real filesystem
    return join(state.workingDir, relativePath);
  }

  function resolveWritePath(relativePath: string): string {
    const sandboxPath = join(sandboxDir, relativePath);
    mkdirSync(dirname(sandboxPath), { recursive: true });
    state.writtenFiles.add(relativePath);
    state.deletedFiles.delete(relativePath);
    return sandboxPath;
  }

  function markDeleted(relativePath: string): void {
    const sandboxPath = join(sandboxDir, relativePath);
    mkdirSync(dirname(sandboxPath), { recursive: true });
    writeFileSync(sandboxPath, TOMBSTONE_MARKER);
    state.deletedFiles.add(relativePath);
    state.writtenFiles.delete(relativePath);
  }

  function commandWorkingDir(): string {
    // For commands, we use the sandbox dir but need to ensure
    // it has the basic structure. Commands will see sandbox files
    // but can also access real files via absolute paths.
    return sandboxDir;
  }

  function recordCommand(command: string): void {
    state.commandsRun.push(command);
  }

  function diff(): SandboxFileDiff[] {
    const diffs: SandboxFileDiff[] = [];

    // Walk sandbox directory for written files
    function walkSandbox(dir: string): void {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walkSandbox(full);
        } else {
          const rel = relative(sandboxDir, full);
          const sandboxContent = readFileSync(full, "utf-8");

          if (sandboxContent === TOMBSTONE_MARKER) {
            // Deleted file
            const originalPath = join(state.workingDir, rel);
            if (existsSync(originalPath)) {
              diffs.push({
                path: rel,
                status: "deleted",
                original: readFileSync(originalPath, "utf-8"),
                modified: null,
              });
            }
            continue;
          }

          const originalPath = join(state.workingDir, rel);
          if (existsSync(originalPath)) {
            const originalContent = readFileSync(originalPath, "utf-8");
            if (originalContent !== sandboxContent) {
              diffs.push({
                path: rel,
                status: "modified",
                original: originalContent,
                modified: sandboxContent,
              });
            }
          } else {
            diffs.push({
              path: rel,
              status: "added",
              original: null,
              modified: sandboxContent,
            });
          }
        }
      }
    }

    walkSandbox(sandboxDir);
    return diffs.sort((a, b) => a.path.localeCompare(b.path));
  }

  function formatDiff(): string {
    const diffs = diff();
    if (diffs.length === 0) return "No changes.";

    const lines: string[] = [];
    for (const d of diffs) {
      lines.push(`--- ${d.status === "added" ? "/dev/null" : `a/${d.path}`}`);
      lines.push(`+++ ${d.status === "deleted" ? "/dev/null" : `b/${d.path}`}`);

      if (d.status === "added") {
        const newLines = (d.modified ?? "").split("\n");
        lines.push(`@@ -0,0 +1,${newLines.length} @@`);
        for (const l of newLines) lines.push(`+${l}`);
      } else if (d.status === "deleted") {
        const oldLines = (d.original ?? "").split("\n");
        lines.push(`@@ -1,${oldLines.length} +0,0 @@`);
        for (const l of oldLines) lines.push(`-${l}`);
      } else {
        // Modified: simple line-by-line diff
        const oldLines = (d.original ?? "").split("\n");
        const newLines = (d.modified ?? "").split("\n");
        lines.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`);

        // Simple diff: show removed then added (not optimal, but clear)
        const maxLen = Math.max(oldLines.length, newLines.length);
        for (let i = 0; i < maxLen; i++) {
          const oldLine = i < oldLines.length ? oldLines[i] : undefined;
          const newLine = i < newLines.length ? newLines[i] : undefined;
          if (oldLine === newLine) {
            lines.push(` ${oldLine ?? ""}`);
          } else {
            if (oldLine !== undefined) lines.push(`-${oldLine}`);
            if (newLine !== undefined) lines.push(`+${newLine}`);
          }
        }
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  function apply(): Result<{ applied: number }> {
    if (state.finalized) return err(new Error("Sandbox already finalized"));
    state.finalized = true;

    const diffs = diff();
    let applied = 0;

    for (const d of diffs) {
      const targetPath = join(state.workingDir, d.path);
      if (d.status === "deleted") {
        if (existsSync(targetPath)) {
          rmSync(targetPath);
          applied++;
        }
      } else {
        // added or modified
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, d.modified ?? "");
        applied++;
      }
    }

    // Clean up sandbox
    cleanup();
    return ok({ applied });
  }

  function discard(): void {
    if (state.finalized) return;
    state.finalized = true;
    cleanup();
  }

  function cleanup(): void {
    try {
      rmSync(sandboxDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  }

  return {
    state: () => state,
    resolveReadPath,
    resolveWritePath,
    markDeleted,
    commandWorkingDir,
    recordCommand,
    diff,
    formatDiff,
    apply,
    discard,
  };
}
