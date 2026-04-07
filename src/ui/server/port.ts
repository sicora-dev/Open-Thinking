/**
 * Port resolution for the UI server.
 *
 * Strategy:
 *   1. If the user passed an explicit port, try it. If busy → error (no fallback).
 *   2. Otherwise try DEFAULT_PORT (17880).
 *   3. If busy, try DEFAULT_PORT+1 .. DEFAULT_PORT+10.
 *   4. If all busy, fall back to an OS-assigned ephemeral port.
 * In every fallback case we log a warning so the user knows.
 */
import { createServer } from "node:net";
import { type Result, err, ok } from "../../shared/result";

export const DEFAULT_PORT = 17880;
export const FALLBACK_RANGE = 10;

export type ResolvedPort = {
  port: number;
  fallback: boolean;
  requested: number | null;
};

/** Try to bind a port on 127.0.0.1. Resolves to true if free. */
function tryPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

/** Ask the OS for a free ephemeral port. */
function ephemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Could not get ephemeral port")));
      }
    });
  });
}

export async function resolvePort(requested?: number | null): Promise<Result<ResolvedPort>> {
  // Explicit user request — strict, no fallback
  if (requested != null) {
    const free = await tryPort(requested);
    if (!free) {
      return err(new Error(`Port ${requested} is already in use.`));
    }
    return ok({ port: requested, fallback: false, requested });
  }

  // Try default
  if (await tryPort(DEFAULT_PORT)) {
    return ok({ port: DEFAULT_PORT, fallback: false, requested: null });
  }

  // Try range
  for (let i = 1; i <= FALLBACK_RANGE; i++) {
    const candidate = DEFAULT_PORT + i;
    if (await tryPort(candidate)) {
      return ok({ port: candidate, fallback: true, requested: null });
    }
  }

  // Last resort — ephemeral
  try {
    const port = await ephemeralPort();
    return ok({ port, fallback: true, requested: null });
  } catch (e) {
    return err(new Error(`Could not find a free port: ${(e as Error).message}`));
  }
}
