import { describe, expect, test } from "bun:test";
import { createPermissionEngine } from "./permission-engine";
import { createPermissionStore } from "./permission-store";
import type { PermissionStore } from "./permission-store";

function createInMemoryStore(): PermissionStore {
  const rules: { tool: string; pattern: string; action: "allow" | "deny"; createdAt: string }[] = [];
  return {
    findRule(tool, subject) {
      for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i]!;
        if (rule.tool === tool && (rule.pattern === subject || rule.pattern === "*")) {
          return rule;
        }
      }
      return null;
    },
    addRule(tool, pattern, action) {
      rules.push({ tool, pattern, action, createdAt: new Date().toISOString() });
    },
    removeRule(tool, pattern) {
      const before = rules.length;
      const filtered = rules.filter((r) => !(r.tool === tool && (!pattern || r.pattern === pattern)));
      rules.length = 0;
      rules.push(...filtered);
      return before - rules.length;
    },
    listRules: () => [...rules],
    clearRules: () => { rules.length = 0; },
  };
}

describe("PermissionEngine", () => {
  test("auto mode allows everything", async () => {
    const engine = createPermissionEngine({
      mode: "auto",
      workingDir: "/tmp/test",
      store: createInMemoryStore(),
    });
    const result = await engine.check("run_command", { command: "rm -rf /" }, "test-stage");
    expect(result).toBe("allow");
  });

  test("sandbox mode allows everything", async () => {
    const engine = createPermissionEngine({
      mode: "sandbox",
      workingDir: "/tmp/test",
      store: createInMemoryStore(),
    });
    const result = await engine.check("write_file", { path: "foo.txt" }, "test-stage");
    expect(result).toBe("allow");
  });

  test("confirm mode auto-allows safe actions (reads)", async () => {
    const engine = createPermissionEngine({
      mode: "confirm",
      workingDir: "/tmp/test",
      store: createInMemoryStore(),
    });
    const result = await engine.check("read_file", { path: "foo.txt" }, "test-stage");
    expect(result).toBe("allow");
  });

  test("confirm mode blocks moderate actions and resolves on approval", async () => {
    const engine = createPermissionEngine({
      mode: "confirm",
      workingDir: "/tmp/test",
      store: createInMemoryStore(),
    });

    // Start the check (it will block waiting for confirmation)
    const checkPromise = engine.check("write_file", { path: "foo.txt" }, "test-stage");

    // Resolve the pending confirmation
    const pending = engine.confirmations().pending();
    expect(pending.length).toBe(1);
    expect(pending[0]!.request.tool).toBe("write_file");
    expect(pending[0]!.request.risk).toBe("moderate");

    engine.confirmations().resolve(pending[0]!.request.id, { action: "allow", remember: false });

    const result = await checkPromise;
    expect(result).toBe("allow");
  });

  test("confirm mode blocks and denies on rejection", async () => {
    const engine = createPermissionEngine({
      mode: "confirm",
      workingDir: "/tmp/test",
      store: createInMemoryStore(),
    });

    const checkPromise = engine.check("write_file", { path: "foo.txt" }, "test-stage");

    const pending = engine.confirmations().pending();
    engine.confirmations().resolve(pending[0]!.request.id, { action: "deny", remember: false });

    const result = await checkPromise;
    expect(result).toBe("deny");
  });

  test("persistent allow rule auto-passes", async () => {
    const store = createInMemoryStore();
    store.addRule("write_file", "foo.txt", "allow");

    const engine = createPermissionEngine({
      mode: "confirm",
      workingDir: "/tmp/test",
      store,
    });

    const result = await engine.check("write_file", { path: "foo.txt" }, "test-stage");
    expect(result).toBe("allow");
  });

  test("persistent deny rule auto-blocks", async () => {
    const store = createInMemoryStore();
    store.addRule("run_command", "rm -rf /", "deny");

    const engine = createPermissionEngine({
      mode: "confirm",
      workingDir: "/tmp/test",
      store,
    });

    const result = await engine.check("run_command", { command: "rm -rf /" }, "test-stage");
    expect(result).toBe("deny");
  });

  test("remember=true persists rule", async () => {
    const store = createInMemoryStore();
    const engine = createPermissionEngine({
      mode: "confirm",
      workingDir: "/tmp/test",
      store,
    });

    const checkPromise = engine.check("write_file", { path: "bar.txt" }, "test-stage");
    const pending = engine.confirmations().pending();
    engine.confirmations().resolve(pending[0]!.request.id, { action: "allow", remember: true });
    await checkPromise;

    // Rule should now be persisted
    expect(store.listRules().length).toBe(1);
    expect(store.findRule("write_file", "bar.txt")?.action).toBe("allow");

    // Second call should auto-pass without blocking
    const result2 = await engine.check("write_file", { path: "bar.txt" }, "test-stage");
    expect(result2).toBe("allow");
  });

  test("strict mode blocks even safe write operations", async () => {
    const engine = createPermissionEngine({
      mode: "strict",
      workingDir: "/tmp/test",
      store: createInMemoryStore(),
    });

    // Safe read should still block in strict mode
    const checkPromise = engine.check("list_files", { path: "." }, "test-stage");

    const pending = engine.confirmations().pending();
    expect(pending.length).toBe(1);
    engine.confirmations().resolve(pending[0]!.request.id, { action: "allow", remember: false });

    const result = await checkPromise;
    expect(result).toBe("allow");
  });

  test("mode() returns the configured mode", () => {
    const engine = createPermissionEngine({
      mode: "strict",
      workingDir: "/tmp/test",
      store: createInMemoryStore(),
    });
    expect(engine.mode()).toBe("strict");
  });
});
