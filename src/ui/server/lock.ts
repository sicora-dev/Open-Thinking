/**
 * UI lock file management.
 * Tracks the running UI server (PID + port) in ~/.openthk/ui.lock.json
 * so other CLI invocations can find, query, or stop it.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Result, err, ok } from "../../shared/result";
import { getOpenthkConfigDir } from "../../config/paths";

function getLockFile(): string {
  return join(getOpenthkConfigDir(), "ui.lock.json");
}

export type UiLock = {
  pid: number;
  port: number;
  startedAt: string;
};

function ensureDir(): void {
  const configDir = getOpenthkConfigDir();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
}

export function getLockPath(): string {
  return getLockFile();
}

/** Check if a process is alive without sending a real signal. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the lock file. If the lock exists but the process is dead,
 * cleans it up and returns null.
 */
export function readLock(): UiLock | null {
  const lockFile = getLockFile();
  if (!existsSync(lockFile)) return null;
  try {
    const raw = readFileSync(lockFile, "utf-8");
    const lock = JSON.parse(raw) as UiLock;
    if (!isProcessAlive(lock.pid)) {
      // Stale lock — clean it up
      try {
        unlinkSync(lockFile);
      } catch {
        // ignore
      }
      return null;
    }
    return lock;
  } catch {
    return null;
  }
}

export function writeLock(lock: UiLock): Result<void> {
  try {
    ensureDir();
    writeFileSync(getLockFile(), JSON.stringify(lock, null, 2), { mode: 0o600 });
    return ok(undefined);
  } catch (e) {
    return err(new Error(`Failed to write UI lock: ${(e as Error).message}`));
  }
}

export function removeLock(): void {
  const lockFile = getLockFile();
  try {
    if (existsSync(lockFile)) unlinkSync(lockFile);
  } catch {
    // ignore
  }
}
