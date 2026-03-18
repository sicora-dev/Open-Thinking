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
});
