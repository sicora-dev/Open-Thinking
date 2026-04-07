import { describe, expect, test } from "bun:test";
import { filterCommandOutput, stripAnsi, universalCleanup } from "./index";

describe("stripAnsi", () => {
  test("removes color codes", () => {
    expect(stripAnsi("\x1b[31merror\x1b[0m: bad")).toBe("error: bad");
  });

  test("plain text passes through unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });
});

describe("universalCleanup", () => {
  test("collapses CR progress updates to nothing (last frame survives)", () => {
    const out = universalCleanup("Downloading 10%\rDownloading 50%\rDownloading 100%\nDone\n");
    expect(out).toContain("Done");
    expect(out).not.toContain("10%");
    expect(out).not.toContain("50%");
  });

  test("collapses 3+ blank lines to 2", () => {
    expect(universalCleanup("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  test("trims trailing whitespace per line", () => {
    expect(universalCleanup("foo   \nbar\t\n")).toBe("foo\nbar\n");
  });
});

describe("filterCommandOutput", () => {
  test("npm: strips deprecation and funding noise", () => {
    const raw = [
      "npm WARN deprecated foo@1.0.0",
      "added 42 packages in 3s",
      "5 packages are looking for funding",
      "  run `npm fund` for details",
      "actual output line",
    ].join("\n");
    const cleaned = filterCommandOutput("npm install", raw);
    expect(cleaned).toContain("actual output line");
    expect(cleaned).not.toContain("deprecated");
    expect(cleaned).not.toContain("funding");
    expect(cleaned).not.toContain("npm fund");
  });

  test("git: strips hint lines and remote progress", () => {
    const raw = [
      "hint: Use 'git pull' to update",
      "remote: Counting objects: 100, done.",
      "Receiving objects: 100% (50/50), done.",
      "Already up to date.",
    ].join("\n");
    const cleaned = filterCommandOutput("git pull", raw);
    expect(cleaned).toContain("Already up to date.");
    expect(cleaned).not.toContain("hint:");
    expect(cleaned).not.toContain("remote: Counting");
    expect(cleaned).not.toContain("Receiving objects");
  });

  test("env-prefixed command still resolves the binary", () => {
    const raw = "npm WARN deprecated x\nbuilt!";
    const cleaned = filterCommandOutput("NODE_ENV=production npm run build", raw);
    expect(cleaned).toContain("built!");
    expect(cleaned).not.toContain("deprecated");
  });

  test("path-prefixed command still resolves the binary", () => {
    const raw = "hint: ignore me\nclean";
    const cleaned = filterCommandOutput("/usr/local/bin/git status", raw);
    expect(cleaned).toContain("clean");
    expect(cleaned).not.toContain("hint:");
  });

  test("unknown command: only universal cleanup applies", () => {
    const raw = "\x1b[32mok\x1b[0m\n";
    expect(filterCommandOutput("ls", raw)).toBe("ok\n");
  });

  test("empty input is preserved", () => {
    expect(filterCommandOutput("npm i", "")).toBe("");
  });
});
