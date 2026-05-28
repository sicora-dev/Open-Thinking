import { describe, expect, test } from "bun:test";
import { createConfirmation, createConfirmationManager } from "./confirmation-gate";
import type { PermissionRequest } from "./permission-types";

function makeRequest(id = "test-1"): PermissionRequest {
  return {
    id,
    tool: "write_file",
    args: { path: "test.txt" },
    risk: "moderate",
    description: "write_file: test.txt",
    subject: "test.txt",
  };
}

describe("createConfirmation", () => {
  test("creates a pending confirmation that resolves", async () => {
    const request = makeRequest();
    const confirmation = createConfirmation(request);
    expect(confirmation.request).toBe(request);

    confirmation.resolve({ action: "allow", remember: false });
    const result = await confirmation.promise;
    expect(result.action).toBe("allow");
    expect(result.remember).toBe(false);
  });
});

describe("ConfirmationManager", () => {
  test("add returns a promise and pending lists it", async () => {
    const mgr = createConfirmationManager();
    const request = makeRequest();

    const promise = mgr.add(request);
    expect(mgr.pending().length).toBe(1);
    expect(mgr.get("test-1")).toBeDefined();

    mgr.resolve("test-1", { action: "allow", remember: false });
    const result = await promise;
    expect(result.action).toBe("allow");
  });

  test("resolve returns false for unknown ID", () => {
    const mgr = createConfirmationManager();
    expect(mgr.resolve("nonexistent", { action: "deny", remember: false })).toBe(false);
  });

  test("clear denies all pending", async () => {
    const mgr = createConfirmationManager();
    const p1 = mgr.add(makeRequest("r1"));
    const p2 = mgr.add(makeRequest("r2"));

    mgr.clear();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.action).toBe("deny");
    expect(r2.action).toBe("deny");
    expect(mgr.pending().length).toBe(0);
  });

  test("auto-cleanup after resolve", async () => {
    const mgr = createConfirmationManager();
    const promise = mgr.add(makeRequest("cleanup-test"));
    expect(mgr.pending().length).toBe(1);

    mgr.resolve("cleanup-test", { action: "allow", remember: true });
    await promise;

    // After resolution, the entry should be cleaned up
    // (microtask timing: the then() cleanup runs after await)
    await new Promise((r) => setTimeout(r, 0));
    expect(mgr.pending().length).toBe(0);
    expect(mgr.get("cleanup-test")).toBeUndefined();
  });
});
