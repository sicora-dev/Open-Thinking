import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createContextStore } from "./context-store";

type Store = ReturnType<typeof createContextStore>;

describe("ContextStore", () => {
  let store: Store;

  beforeEach(() => {
    store = createContextStore({ dbPath: ":memory:" });
  });

  afterEach(() => {
    store.close();
  });

  test("set and get a key", async () => {
    const setResult = await store.set("plan.architecture", "microservices", "planner");
    expect(setResult.ok).toBe(true);

    const getResult = await store.get("plan.architecture");
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;

    expect(getResult.value).not.toBeNull();
    expect(getResult.value?.key).toBe("plan.architecture");
    expect(getResult.value?.value).toBe("microservices");
    expect(getResult.value?.createdBy).toBe("planner");
    expect(getResult.value?.createdAt).toBeInstanceOf(Date);
  });

  test("get returns null for missing key", async () => {
    const result = await store.get("nonexistent");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  test("upserts on duplicate key", async () => {
    await store.set("code.main", "v1", "coder");
    await store.set("code.main", "v2", "reviewer");

    const result = await store.get("code.main");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.value).toBe("v2");
    expect(result.value?.createdBy).toBe("reviewer");
  });

  test("delete removes a key", async () => {
    await store.set("temp.data", "value", "stage1");
    await store.delete("temp.data");

    const result = await store.get("temp.data");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  test("list returns all entries", async () => {
    await store.set("plan.arch", "monolith", "planner");
    await store.set("plan.tech", "typescript", "planner");
    await store.set("code.main", "console.log", "coder");

    const result = await store.list();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);
  });

  test("list with prefix filters by namespace", async () => {
    await store.set("plan.arch", "monolith", "planner");
    await store.set("plan.tech", "typescript", "planner");
    await store.set("code.main", "console.log", "coder");

    const result = await store.list("plan.");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.every((e) => e.key.startsWith("plan."))).toBe(true);
  });

  test("clear removes all entries", async () => {
    await store.set("a", "1", "s1");
    await store.set("b", "2", "s2");
    await store.clear();

    const result = await store.list();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  test("inspect returns all entries including expired", async () => {
    const expiring = createContextStore({ dbPath: ":memory:", defaultTtlMs: 1 });
    await expiring.set("fast", "value", "stage");
    // Wait just enough for TTL to pass
    await new Promise((r) => setTimeout(r, 10));

    const inspectResult = expiring.inspect();
    expect(inspectResult.ok).toBe(true);
    if (inspectResult.ok) {
      // inspect() returns all rows regardless of expiry
      expect(inspectResult.value).toHaveLength(1);
    }
    expiring.close();
  });

  test("expired entries are not returned by get", async () => {
    const expiring = createContextStore({ dbPath: ":memory:", defaultTtlMs: 1 });
    await expiring.set("fast", "value", "stage");
    await new Promise((r) => setTimeout(r, 10));

    const result = await expiring.get("fast");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
    expiring.close();
  });

  test("expired entries are filtered from list", async () => {
    const expiring = createContextStore({ dbPath: ":memory:", defaultTtlMs: 1 });
    await expiring.set("fast", "value", "stage");
    await new Promise((r) => setTimeout(r, 10));

    const result = await expiring.list();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    expiring.close();
  });

  test("purgeExpired removes expired rows", async () => {
    const expiring = createContextStore({ dbPath: ":memory:", defaultTtlMs: 1 });
    await expiring.set("fast", "value", "stage");
    await new Promise((r) => setTimeout(r, 10));

    const purgeResult = expiring.purgeExpired();
    expect(purgeResult.ok).toBe(true);
    if (purgeResult.ok) expect(purgeResult.value).toBe(1);

    const inspectResult = expiring.inspect();
    if (inspectResult.ok) expect(inspectResult.value).toHaveLength(0);
    expiring.close();
  });

  // ─── Snapshot tests ───────────────────────────────────

  test("saveSnapshot captures current entries", async () => {
    await store.set("key1", "value1", "stage1");
    await store.set("key2", "value2", "stage2");

    const result = store.saveSnapshot("test-snap", "user");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("test-snap");
    expect(result.value.entryCount).toBe(2);
    expect(result.value.id).toBeTruthy();
  });

  test("listSnapshots returns saved snapshots", async () => {
    await store.set("key1", "value1", "s1");
    store.saveSnapshot("snap1", "user");
    store.saveSnapshot("snap2", "user", "description here");

    const result = store.listSnapshots();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(2);
    // Both snapshots present
    const names = result.value.map((s) => s.name);
    expect(names).toContain("snap1");
    expect(names).toContain("snap2");
    const snap2 = result.value.find((s) => s.name === "snap2");
    expect(snap2?.description).toBe("description here");
  });

  test("restoreSnapshot replaces current entries", async () => {
    await store.set("original", "data", "s1");
    const snap = store.saveSnapshot("before-change", "user");
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;

    // Modify context
    await store.set("original", "modified", "s2");
    await store.set("new-key", "new-value", "s2");

    // Restore
    const result = store.restoreSnapshot(snap.value.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.restored).toBe(1);

    // Verify state
    const entry = await store.get("original");
    expect(entry.ok).toBe(true);
    if (entry.ok) expect(entry.value?.value).toBe("data");

    const newKey = await store.get("new-key");
    expect(newKey.ok).toBe(true);
    if (newKey.ok) expect(newKey.value).toBeNull(); // new-key was not in snapshot
  });

  test("deleteSnapshot removes a snapshot", async () => {
    await store.set("k", "v", "s");
    const snap = store.saveSnapshot("to-delete", "user");
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;

    const del = store.deleteSnapshot(snap.value.id);
    expect(del.ok).toBe(true);
    if (del.ok) expect(del.value).toBe(true);

    const list = store.listSnapshots();
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value.length).toBe(0);
  });

  test("getSnapshot returns full entry data", async () => {
    await store.set("a", "1", "s1");
    await store.set("b", "2", "s2");
    const snap = store.saveSnapshot("full", "user");
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;

    const result = store.getSnapshot(snap.value.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
    expect(result.value!.entries.length).toBe(2);
    expect(result.value!.entries.find((e) => e.key === "a")?.value).toBe("1");
  });

  test("getSnapshot returns null for unknown ID", () => {
    const result = store.getSnapshot("nonexistent");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  test("restoreSnapshot fails for unknown ID", () => {
    const result = store.restoreSnapshot("nonexistent");
    expect(result.ok).toBe(false);
  });

  test("saveSnapshot on empty store creates empty snapshot", () => {
    const result = store.saveSnapshot("empty", "user");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.entryCount).toBe(0);
  });
});
