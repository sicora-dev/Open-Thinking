/**
 * UI server lifecycle: start (detached), stop, status, restart.
 *
 * `start()` re-launches the CLI in UI-server mode as a detached child so it
 * survives the parent CLI and works both from source and from the compiled binary.
 * Logs go to ~/.openthk/logs/ui.log. PID + port persisted in ui.lock.json.
 */
import { existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { type Result, err, ok } from "../../shared/result";
import { getOpenthkConfigDir } from "../../config/paths";
import { type UiLock, isProcessAlive, readLock, removeLock } from "./lock";

function getLogDir(): string {
  return join(getOpenthkConfigDir(), "logs");
}

function getLogFile(): string {
  return join(getLogDir(), "ui.log");
}

export type StartOptions = {
  port?: number | null;
  /** If true, run in foreground (no detach, inherit stdio). */
  foreground?: boolean;
};

export type StartResult = {
  pid: number;
  port: number;
  alreadyRunning: boolean;
};

function ensureLogDir(): void {
  const logDir = getLogDir();
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
}

function getServerCommand(): string[] {
  const overrideEntry = process.env.OPENTHK_UI_CLI_ENTRY;
  if (overrideEntry) {
    return [process.execPath, overrideEntry];
  }

  const entryArg = process.argv[1];
  const maybeScriptEntry =
    entryArg && /\.(?:[cm]?[jt]s|tsx?)$/i.test(entryArg) ? [entryArg] : [];
  return [process.execPath, ...maybeScriptEntry];
}

/** Wait until the lock file appears (or timeout). */
async function waitForLock(timeoutMs = 5000): Promise<UiLock | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const lock = readLock();
    if (lock) return lock;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

export async function startUi(options: StartOptions = {}): Promise<Result<StartResult>> {
  const existing = readLock();
  if (existing) {
    return ok({ pid: existing.pid, port: existing.port, alreadyRunning: true });
  }

  ensureLogDir();
  const logFile = getLogFile();
  const logFd = openSync(logFile, "a");

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (options.port != null) env.OPENTHK_UI_PORT = String(options.port);
  env.OPENTHK_UI_SERVER = "1";
  const command = getServerCommand();

  if (options.foreground) {
    // Foreground mode — replace the current process flow.
    const proc = Bun.spawn({
      cmd: command,
      env,
      stdio: ["inherit", "inherit", "inherit"],
    });
    await proc.exited;
    return ok({ pid: proc.pid, port: 0, alreadyRunning: false });
  }

  // Detached background spawn
  const proc = Bun.spawn({
    cmd: command,
    env,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  // Detach so the parent CLI can exit
  if (typeof (proc as unknown as { unref?: () => void }).unref === "function") {
    (proc as unknown as { unref: () => void }).unref();
  }

  const lock = await waitForLock(5000);
  if (!lock) {
    return err(
      new Error(`UI server failed to start within 5s. Check logs at ${logFile}`),
    );
  }

  return ok({ pid: lock.pid, port: lock.port, alreadyRunning: false });
}

export type StopResult = { stopped: boolean; pid?: number };

export async function stopUi(): Promise<Result<StopResult>> {
  const lock = readLock();
  if (!lock) {
    return ok({ stopped: false });
  }

  try {
    process.kill(lock.pid, "SIGTERM");
  } catch (e) {
    // Already dead
    removeLock();
    return ok({ stopped: false, pid: lock.pid });
  }

  // Wait up to 3s for graceful shutdown
  const start = Date.now();
  while (Date.now() - start < 3000) {
    if (!isProcessAlive(lock.pid)) {
      removeLock();
      return ok({ stopped: true, pid: lock.pid });
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // Force kill
  try {
    process.kill(lock.pid, "SIGKILL");
  } catch {
    // ignore
  }
  removeLock();
  return ok({ stopped: true, pid: lock.pid });
}

export type StatusResult =
  | { running: false }
  | { running: true; pid: number; port: number; url: string; startedAt: string };

export function statusUi(): StatusResult {
  const lock = readLock();
  if (!lock) return { running: false };
  return {
    running: true,
    pid: lock.pid,
    port: lock.port,
    url: `http://127.0.0.1:${lock.port}`,
    startedAt: lock.startedAt,
  };
}

export async function restartUi(options: StartOptions = {}): Promise<Result<StartResult>> {
  await stopUi();
  return startUi(options);
}

export function getLogPath(): string {
  return getLogFile();
}
