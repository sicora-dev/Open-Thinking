/**
 * Tests for UI server lifecycle.
 * These hit a real spawned UI server on a real (ephemeral) port.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolvePort } from "./port";
import { isProcessAlive, readLock, removeLock } from "./lock";
import { startUi, statusUi, stopUi } from "./lifecycle";

let configDir = "";

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "openthk-ui-config-"));
  process.env.OPENTHK_CONFIG_DIR = configDir;
  process.env.OPENTHK_UI_CLI_ENTRY = resolve(process.cwd(), "src/cli/index.ts");
});

describe("port resolver", () => {
  test("returns a free port when no preference is given", async () => {
    const r = await resolvePort(null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.port).toBeGreaterThan(0);
  });

  test("honors an explicit free port", async () => {
    // ask for an ephemeral port via raw resolver, then re-resolve same port
    const first = await resolvePort(null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const r = await resolvePort(first.value.port);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.port).toBe(first.value.port);
  });
});

describe("lifecycle", () => {
  afterEach(async () => {
    // Clean up any leaked server between tests
    const lock = readLock();
    if (lock) {
      try {
        process.kill(lock.pid, "SIGKILL");
      } catch {}
    }
    removeLock();
    rmSync(configDir, { recursive: true, force: true });
    delete process.env.OPENTHK_CONFIG_DIR;
    delete process.env.OPENTHK_UI_CLI_ENTRY;
  });

  test("start writes a lock and status reports running", async () => {
    const result = await startUi({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.pid).toBeGreaterThan(0);
    expect(isProcessAlive(result.value.pid)).toBe(true);

    const status = statusUi();
    expect(status.running).toBe(true);

    // Health endpoint
    const res = await fetch(`http://127.0.0.1:${result.value.port}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  }, 15000);

  test("start is idempotent (returns alreadyRunning)", async () => {
    const first = await startUi({});
    expect(first.ok).toBe(true);
    const second = await startUi({});
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.alreadyRunning).toBe(true);
      expect(second.value.pid).toBe(first.value.pid);
    }
  }, 15000);

  test("stop terminates the process and clears the lock", async () => {
    const start = await startUi({});
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const stop = await stopUi();
    expect(stop.ok).toBe(true);
    if (stop.ok) expect(stop.value.stopped).toBe(true);

    expect(readLock()).toBeNull();
    expect(statusUi().running).toBe(false);
  }, 15000);
});
