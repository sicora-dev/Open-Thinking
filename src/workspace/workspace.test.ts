import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  type PipelineOrigin,
  clearPipelineDefault,
  findPipelineConflicts,
  formatPersistentContext,
  getActivePipelineName,
  getProjectDir,
  hasProjectWorkspace,
  initProjectWorkspace,
  listAvailablePipelines,
  loadStageContext,
  pipelineNameFromFilename,
  purgeOldHistory,
  readLearned,
  readProjectSoul,
  readRecentHistory,
  readStageInstructions,
  resolvePipelinePath,
  setActivePipeline,
  writeHistoryEntry,
  writeLearned,
  writeProjectSoul,
} from "./workspace";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "openthk-ws-test-"));
}

describe("workspace", () => {
  // ─── initProjectWorkspace ────────────────────────────────

  test("creates .openthk/ directory structure", () => {
    const dir = makeTempDir();
    const result = initProjectWorkspace(dir);

    expect(result).toBe(true);
    expect(existsSync(join(dir, ".openthk"))).toBe(true);
    expect(existsSync(join(dir, ".openthk", "stages"))).toBe(true);
    expect(existsSync(join(dir, ".openthk", "history"))).toBe(true);
    expect(existsSync(join(dir, ".openthk", "learned"))).toBe(true);
    expect(existsSync(join(dir, ".openthk", "project.md"))).toBe(true);
    expect(existsSync(join(dir, ".openthk", ".gitignore"))).toBe(true);
  });

  test("returns false if .openthk/ already exists", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    const result = initProjectWorkspace(dir);
    expect(result).toBe(false);
  });

  test("hasProjectWorkspace returns true after init", () => {
    const dir = makeTempDir();
    expect(hasProjectWorkspace(dir)).toBe(false);
    initProjectWorkspace(dir);
    expect(hasProjectWorkspace(dir)).toBe(true);
  });

  // ─── readProjectSoul ────────────────────────────────────

  test("readProjectSoul returns null for template-only content", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    expect(readProjectSoul(dir)).toBeNull();
  });

  test("readProjectSoul returns content when filled in", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    writeProjectSoul(dir, "# Project\n\nThis is a real project.");
    expect(readProjectSoul(dir)).toContain("real project");
  });

  // ─── readStageInstructions ──────────────────────────────

  test("readStageInstructions returns null when file missing", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    expect(readStageInstructions(dir, "planner")).toBeNull();
  });

  test("readStageInstructions reads stage-specific file", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    writeFileSync(
      join(getProjectDir(dir), "stages", "planner.md"),
      "Always use bullet points.",
    );
    expect(readStageInstructions(dir, "planner")).toBe("Always use bullet points.");
  });

  // ─── writeHistoryEntry ──────────────────────────────────

  test("writeHistoryEntry creates timestamped file", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    const filename = writeHistoryEntry(dir, "# Run 1\nStuff happened.");
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}_001\.md$/);

    const content = readFileSync(join(getProjectDir(dir), "history", filename), "utf-8");
    expect(content).toContain("Stuff happened");
  });

  test("writeHistoryEntry increments sequence number", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    const f1 = writeHistoryEntry(dir, "Run 1");
    const f2 = writeHistoryEntry(dir, "Run 2");
    expect(f1).toContain("_001.md");
    expect(f2).toContain("_002.md");
  });

  // ─── readRecentHistory ──────────────────────────────────

  test("readRecentHistory returns null when empty", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    expect(readRecentHistory(dir)).toBeNull();
  });

  test("readRecentHistory returns entries in reverse order", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    writeHistoryEntry(dir, "First run");
    writeHistoryEntry(dir, "Second run");
    const history = readRecentHistory(dir);
    expect(history).not.toBeNull();
    // Second run should appear first (most recent)
    const idx1 = history!.indexOf("Second run");
    const idx2 = history!.indexOf("First run");
    expect(idx1).toBeLessThan(idx2);
  });

  // ─── writeLearned / readLearned ─────────────────────────

  test("writeLearned and readLearned round-trip", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    writeLearned(dir, "conventions.md", "# Conventions\n\nUse tabs.");
    const learned = readLearned(dir);
    expect(learned).toContain("Use tabs");
  });

  // ─── purgeOldHistory ────────────────────────────────────

  test("purgeOldHistory removes old entries", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);

    // Write a fake old history file
    const oldDate = "2020-01-01";
    writeFileSync(
      join(getProjectDir(dir), "history", `${oldDate}_001.md`),
      "Old entry",
    );
    writeHistoryEntry(dir, "Recent entry");

    const purged = purgeOldHistory(dir, 30);
    expect(purged).toBe(1);

    const history = readRecentHistory(dir);
    expect(history).toContain("Recent entry");
    expect(history).not.toContain("Old entry");
  });

  // ─── loadStageContext / formatPersistentContext ──────────

  test("loadStageContext returns all null for empty workspace", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    const ctx = loadStageContext(dir, "planner");
    expect(ctx.projectSoul).toBeNull();
    expect(ctx.stageInstructions).toBeNull();
    expect(ctx.learned).toBeNull();
    expect(ctx.recentHistory).toBeNull();
  });

  test("formatPersistentContext produces XML blocks", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    writeProjectSoul(dir, "# My Project\n\nA cool project.");
    writeFileSync(
      join(getProjectDir(dir), "stages", "coder.md"),
      "Write clean code.",
    );

    const ctx = loadStageContext(dir, "coder");
    const formatted = formatPersistentContext(ctx);
    expect(formatted).toContain("<project>");
    expect(formatted).toContain("A cool project");
    expect(formatted).toContain("<stage-instructions>");
    expect(formatted).toContain("Write clean code");
  });

  test("formatPersistentContext returns empty string when no context", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    const ctx = loadStageContext(dir, "planner");
    expect(formatPersistentContext(ctx)).toBe("");
  });

  // ─── Pipeline Registry ────────────────────────────────────

  test("initProjectWorkspace creates pipelines/ directory", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    expect(existsSync(join(dir, ".openthk", "pipelines"))).toBe(true);
  });

  test(".gitignore includes active-pipeline", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    const gitignore = readFileSync(join(dir, ".openthk", ".gitignore"), "utf-8");
    expect(gitignore).toContain("active-pipeline");
  });

  test("pipelineNameFromFilename strips extensions correctly", () => {
    expect(pipelineNameFromFilename("dev-flow.yaml")).toBe("dev-flow");
    expect(pipelineNameFromFilename("dev-flow.yml")).toBe("dev-flow");
    expect(pipelineNameFromFilename("dev-flow.pipeline.yaml")).toBe("dev-flow");
    expect(pipelineNameFromFilename("dev-flow.pipeline.yml")).toBe("dev-flow");
    expect(pipelineNameFromFilename("my.complex.name.yaml")).toBe("my.complex.name");
  });

  test("listAvailablePipelines returns project pipelines", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    writeFileSync(join(dir, ".openthk", "pipelines", "dev-flow.yaml"), "name: dev-flow\n");
    writeFileSync(join(dir, ".openthk", "pipelines", "review.yaml"), "name: review\n");

    const pipelines = listAvailablePipelines(dir);
    const projectPipelines = pipelines.filter((p) => p.origin === "project");
    expect(projectPipelines.length).toBe(2);
    expect(projectPipelines.map((p) => p.name).sort()).toEqual(["dev-flow", "review"]);
  });

  test("getActivePipelineName returns null when no file", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    expect(getActivePipelineName(dir)).toBeNull();
  });

  test("setActivePipeline / getActivePipelineName round-trip", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    setActivePipeline(dir, "dev-flow");
    expect(getActivePipelineName(dir)).toBe("dev-flow");
  });

  test("setActivePipeline overwrites previous value", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    setActivePipeline(dir, "dev-flow");
    setActivePipeline(dir, "review");
    expect(getActivePipelineName(dir)).toBe("review");
  });

  test("findPipelineConflicts returns matching entries", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    writeFileSync(join(dir, ".openthk", "pipelines", "dev-flow.yaml"), "name: dev-flow\n");

    const conflicts = findPipelineConflicts(dir, "dev-flow");
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.origin).toBe("project");
  });

  test("findPipelineConflicts returns empty for unknown name", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    expect(findPipelineConflicts(dir, "nonexistent")).toEqual([]);
  });

  test("resolvePipelinePath resolves single pipeline", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    const yamlPath = join(dir, ".openthk", "pipelines", "dev-flow.yaml");
    writeFileSync(yamlPath, "name: dev-flow\n");

    const result = resolvePipelinePath(dir, "dev-flow");
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("conflict");
    expect((result as { path: string }).path).toBe(yamlPath);
  });

  test("resolvePipelinePath returns null for unknown name", () => {
    const dir = makeTempDir();
    initProjectWorkspace(dir);
    expect(resolvePipelinePath(dir, "nonexistent")).toBeNull();
  });
});
