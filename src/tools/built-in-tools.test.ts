import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createListFilesTool,
  createReadFileTool,
  createRunCommandTool,
  createSearchFilesTool,
  createWriteFileTool,
} from "./built-in-tools";

const TEST_DIR = join(import.meta.dir, "__test_workspace__");

beforeAll(() => {
  mkdirSync(join(TEST_DIR, "src"), { recursive: true });
  writeFileSync(join(TEST_DIR, "hello.txt"), "Hello, world!");
  writeFileSync(join(TEST_DIR, "src", "index.ts"), 'console.log("hello");\nconst x = 42;\n');
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("read_file", () => {
  const tool = createReadFileTool(TEST_DIR);

  test("reads a file", async () => {
    const result = await tool.execute({ path: "hello.txt" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("Hello, world!");
  });

  test("returns error for missing file", async () => {
    const result = await tool.execute({ path: "nope.txt" });
    expect(result.ok).toBe(false);
  });

  test("blocks path traversal", async () => {
    const result = await tool.execute({ path: "../../etc/passwd" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("traversal");
  });
});

describe("write_file", () => {
  const tool = createWriteFileTool(TEST_DIR);

  test("writes a new file", async () => {
    const result = await tool.execute({ path: "output.txt", content: "test content" });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(TEST_DIR, "output.txt"), "utf-8")).toBe("test content");
  });

  test("creates directories", async () => {
    const result = await tool.execute({ path: "new/deep/file.txt", content: "deep" });
    expect(result.ok).toBe(true);
    expect(existsSync(join(TEST_DIR, "new/deep/file.txt"))).toBe(true);
  });

  test("blocks path traversal", async () => {
    const result = await tool.execute({ path: "../escape.txt", content: "bad" });
    expect(result.ok).toBe(false);
  });
});

describe("list_files", () => {
  const tool = createListFilesTool(TEST_DIR);

  test("lists files in root", async () => {
    const result = await tool.execute({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("hello.txt");
      expect(result.value).toContain("src/");
    }
  });

  test("lists recursively", async () => {
    const result = await tool.execute({ recursive: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("src/index.ts");
    }
  });
});

describe("run_command", () => {
  const tool = createRunCommandTool(TEST_DIR);

  test("executes a command", async () => {
    const result = await tool.execute({ command: "echo hello" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain("hello");
  });

  test("returns exit code on failure", async () => {
    const result = await tool.execute({ command: "false" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain("Exit code:");
  });
});

describe("search_files", () => {
  const tool = createSearchFilesTool(TEST_DIR);

  test("finds a pattern", async () => {
    const result = await tool.execute({ pattern: "console\\.log" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("src/index.ts");
      expect(result.value).toContain("console.log");
    }
  });

  test("returns no matches", async () => {
    const result = await tool.execute({ pattern: "ZZZNOMATCH" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("No matches found.");
  });

  test("filters by glob", async () => {
    const result = await tool.execute({ pattern: "42", glob: "*.ts" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain("index.ts");
  });
});
