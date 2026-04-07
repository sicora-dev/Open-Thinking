/**
 * Static asset serving for the embedded frontend.
 *
 * Resolves the Vite build output (`src/ui/web/dist`) relative to this file
 * at runtime. If the build hasn't been produced yet, returns null so the
 * server can fall back to the placeholder HTML.
 *
 * SPA fallback: any non-API, non-asset path returns index.html so the
 * hash router takes over.
 */
import { existsSync, statSync } from "node:fs";
import { Buffer } from "node:buffer";
import { extname, join, resolve } from "node:path";
import { EMBEDDED_FRONTEND_ASSETS } from "./embedded-assets.generated";

// src/ui/server/static-assets.ts → src/ui/web/dist
const DIST_DIR = resolve(import.meta.dir, "..", "web", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export function hasFrontendBuild(): boolean {
  return Object.keys(EMBEDDED_FRONTEND_ASSETS).length > 0 || existsSync(join(DIST_DIR, "index.html"));
}

function serveEmbedded(pathname: string): Response | null {
  const cleanPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const asset = EMBEDDED_FRONTEND_ASSETS[cleanPath];
  if (asset) {
    return new Response(Buffer.from(asset.bodyBase64, "base64"), {
      headers: {
        "content-type": asset.contentType,
        "cache-control": asset.cacheControl,
      },
    });
  }

  if (!extname(cleanPath)) {
    const indexHtml = EMBEDDED_FRONTEND_ASSETS["index.html"];
    if (indexHtml) {
      return new Response(Buffer.from(indexHtml.bodyBase64, "base64"), {
        headers: {
          "content-type": indexHtml.contentType,
          "cache-control": indexHtml.cacheControl,
        },
      });
    }
  }

  return null;
}

/**
 * Try to serve a static file. Returns null if the request doesn't match
 * an asset (so the caller can return 404 / fall through).
 *
 * Always serves index.html for unknown paths if the build exists (SPA).
 */
export async function serveStatic(pathname: string): Promise<Response | null> {
  if (!hasFrontendBuild()) return null;

  const embeddedResponse = serveEmbedded(pathname);
  if (embeddedResponse) return embeddedResponse;

  // Strip leading slash, default to index.html
  const cleanPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(DIST_DIR, cleanPath);

  // Path traversal guard
  if (!candidate.startsWith(DIST_DIR)) return null;

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    const file = Bun.file(candidate);
    const ext = extname(candidate).toLowerCase();
    return new Response(file, {
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "cache-control": ext === ".html" ? "no-store" : "public, max-age=3600",
      },
    });
  }

  // SPA fallback — only for paths that look like client routes
  // (no extension, doesn't start with /api or /assets that doesn't exist)
  if (!extname(cleanPath)) {
    const indexHtml = join(DIST_DIR, "index.html");
    return new Response(Bun.file(indexHtml), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return null;
}
