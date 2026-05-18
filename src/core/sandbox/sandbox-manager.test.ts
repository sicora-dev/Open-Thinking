import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSandbox } from "./sandbox-manager";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `sandbox-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  const { rmSync } = require("node:fs");
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {}
});

describe("Sandbox Manager", () => {
  test("creates sandbox directory", () => {
    const sandbox = createSandbox(testDir);
    expect(existsSync(sandbox.state().sandboxDir)).toBe(true);
    sandbox.discard();
  });

  test("resolveReadPath falls through to real FS", () => {
    writeFileSync(join(testDir, "real.txt"), "real content");
    const sandbox = createSandbox(testDir);

    const path = sandbox.resolveReadPath("real.txt");
    expect(path).toBe(join(testDir, "real.txt"));
    expect(readFileSync(path, "utf-8")).toBe("real content");
    sandbox.discard();
  });

  test("resolveReadPath returns sandbox path for written files", () => {
    writeFileSync(join(testDir, "original.txt"), "original");
    const sandbox = createSandbox(testDir);

    const writePath = sandbox.resolveWritePath("original.txt");
    writeFileSync(writePath, "modified in sandbox");

    const readPath = sandbox.resolveReadPath("original.txt");
    expect(readPath).toContain("sandbox");
    expect(readFileSync(readPath, "utf-8")).toBe("modified in sandbox");
    sandbox.discard();
  });

  test("resolveWritePath creates parent directories", () => {
    const sandbox = createSandbox(testDir);
    const writePath = sandbox.resolveWritePath("deep/nested/file.txt");
    writeFileSync(writePath, "content");
    expect(readFileSync(writePath, "utf-8")).toBe("content");
    sandbox.discard();
  });

  test("diff detects added files", () => {
    const sandbox = createSandbox(testDir);
    const writePath = sandbox.resolveWritePath("new.txt");
    writeFileSync(writePath, "new file");

    const diffs = sandbox.diff();
    expect(diffs.length).toBe(1);
    expect(diffs[0]!.path).toBe("new.txt");
    expect(diffs[0]!.status).toBe("added");
    expect(diffs[0]!.original).toBeNull();
    expect(diffs[0]!.modified).toBe("new file");
    sandbox.discard();
  });

  test("diff detects modified files", () => {
    writeFileSync(join(testDir, "existing.txt"), "original");
    const sandbox = createSandbox(testDir);

    const writePath = sandbox.resolveWritePath("existing.txt");
    writeFileSync(writePath, "modified");

    const diffs = sandbox.diff();
    expect(diffs.length).toBe(1);
    expect(diffs[0]!.status).toBe("modified");
    expect(diffs[0]!.original).toBe("original");
    expect(diffs[0]!.modified).toBe("modified");
    sandbox.discard();
  });

  test("diff detects deleted files", () => {
    writeFileSync(join(testDir, "to-delete.txt"), "content");
    const sandbox = createSandbox(testDir);
    sandbox.markDeleted("to-delete.txt");

    const diffs = sandbox.diff();
    expect(diffs.length).toBe(1);
    expect(diffs[0]!.status).toBe("deleted");
    expect(diffs[0]!.original).toBe("content");
    expect(diffs[0]!.modified).toBeNull();
    sandbox.discard();
  });

  test("apply writes sandbox changes to real filesystem", () => {
    writeFileSync(join(testDir, "modify-me.txt"), "old");
    const sandbox = createSandbox(testDir);

    // Write a new file and modify an existing one
    writeFileSync(sandbox.resolveWritePath("new-file.txt"), "new");
    writeFileSync(sandbox.resolveWritePath("modify-me.txt"), "new content");

    const result = sandbox.apply();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.applied).toBe(2);
    }

    expect(readFileSync(join(testDir, "new-file.txt"), "utf-8")).toBe("new");
    expect(readFileSync(join(testDir, "modify-me.txt"), "utf-8")).toBe("new content");
  });

  test("discard cleans up sandbox directory", () => {
    const sandbox = createSandbox(testDir);
    const sandboxDir = sandbox.state().sandboxDir;
    expect(existsSync(sandboxDir)).toBe(true);

    sandbox.discard();
    expect(existsSync(sandboxDir)).toBe(false);
  });

  test("apply removes sandbox directory", () => {
    const sandbox = createSandbox(testDir);
    const sandboxDir = sandbox.state().sandboxDir;
    writeFileSync(sandbox.resolveWritePath("test.txt"), "content");

    sandbox.apply();
    expect(existsSync(sandboxDir)).toBe(false);
  });

  test("double apply returns error", () => {
    const sandbox = createSandbox(testDir);
    writeFileSync(sandbox.resolveWritePath("test.txt"), "content");
    sandbox.apply();

    const result = sandbox.apply();
    expect(result.ok).toBe(false);
  });

  test("formatDiff produces readable output", () => {
    writeFileSync(join(testDir, "file.txt"), "old content");
    const sandbox = createSandbox(testDir);
    writeFileSync(sandbox.resolveWritePath("file.txt"), "new content");

    const formatted = sandbox.formatDiff();
    expect(formatted).toContain("--- a/file.txt");
    expect(formatted).toContain("+++ b/file.txt");
    expect(formatted).toContain("-old content");
    expect(formatted).toContain("+new content");
    sandbox.discard();
  });

  test("no changes produces empty diff", () => {
    const sandbox = createSandbox(testDir);
    const formatted = sandbox.formatDiff();
    expect(formatted).toBe("No changes.");
    sandbox.discard();
  });

  test("recordCommand tracks commands", () => {
    const sandbox = createSandbox(testDir);
    sandbox.recordCommand("echo hello");
    sandbox.recordCommand("ls -la");
    expect(sandbox.state().commandsRun).toEqual(["echo hello", "ls -la"]);
    sandbox.discard();
  });
});
