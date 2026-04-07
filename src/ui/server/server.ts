/**
 * UI HTTP server (Bun.serve).
 *
 * Phase A: foundation only.
 * - Binds to 127.0.0.1
 * - GET /api/health → { ok, version, startedAt }
 * - GET / → placeholder until the frontend is built (Phase C)
 * - Clean SIGTERM/SIGINT shutdown
 *
 * This file is meant to be the entry point of the spawned UI process.
 * It reads the port from OPENTHK_UI_PORT (set by the lifecycle spawner).
 */
import { resolvePort } from "./port";
import { writeLock, removeLock } from "./lock";
import { handleRequest } from "./routes";
import { hasFrontendBuild, serveStatic } from "./static-assets";
import { VERSION } from "../../version";

const startedAt = new Date().toISOString();

function placeholderHtml(port: number): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>OpenThinking</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5; margin: 0; padding: 3rem; }
    h1 { color: #06b6d4; font-weight: 600; margin: 0 0 0.5rem; }
    .muted { color: #737373; font-size: 0.9rem; }
    code { background: #171717; padding: 0.15rem 0.4rem; border-radius: 3px; color: #06b6d4; }
  </style>
</head>
<body>
  <h1>OpenThinking</h1>
  <p class="muted">UI server running on port <code>${port}</code> · v${VERSION}</p>
  <p class="muted">Frontend not yet built. See <code>TODO.md</code> Phase C.</p>
</body>
</html>`;
}

export async function startUiHttpServer(): Promise<void> {
  const requestedRaw = process.env.OPENTHK_UI_PORT;
  const requested = requestedRaw ? Number(requestedRaw) : null;
  const portResult = await resolvePort(requested);
  if (!portResult.ok) {
    console.error(`[openthk-ui] ${portResult.error.message}`);
    process.exit(1);
  }
  const { port, fallback } = portResult.value;

  if (fallback) {
    console.error(`[openthk-ui] ⚠ Default port busy, using ${port} instead.`);
  }

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname.startsWith("/api/")) {
        try {
          return await handleRequest(req, port);
        } catch (e) {
          return new Response(
            JSON.stringify({ ok: false, error: (e as Error).message }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
      }

      // Try static frontend assets (SPA fallback included)
      const staticRes = await serveStatic(url.pathname);
      if (staticRes) return staticRes;

      // No frontend build → serve placeholder for the root only
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(placeholderHtml(port), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      return new Response(JSON.stringify({ ok: false, error: "Not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    },
  });

  if (hasFrontendBuild()) {
    console.error(`[openthk-ui] serving frontend from build`);
  } else {
    console.error(`[openthk-ui] frontend not built — serving placeholder`);
  }

  const lockResult = writeLock({ pid: process.pid, port, startedAt });
  if (!lockResult.ok) {
    console.error(`[openthk-ui] Failed to write lock: ${lockResult.error.message}`);
  }

  console.error(`[openthk-ui] listening on http://127.0.0.1:${port} (pid ${process.pid})`);

  const shutdown = (signal: string) => {
    console.error(`[openthk-ui] received ${signal}, shutting down`);
    try {
      server.stop();
    } catch {
      // ignore
    }
    removeLock();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (import.meta.main) {
  startUiHttpServer().catch((e) => {
    console.error(`[openthk-ui] fatal: ${(e as Error).message}`);
    removeLock();
    process.exit(1);
  });
}
