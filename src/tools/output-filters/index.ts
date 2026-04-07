/**
 * Output filters for `run_command`.
 *
 * Token efficiency strategy: shell commands routinely emit a lot of
 * noise — ANSI colour codes, progress bars, repeated download lines,
 * deprecation warnings — that the LLM does not need. We strip and
 * collapse this content *before* the result is sent back through the
 * agent loop, where every byte is paid for in the next prompt.
 *
 * The architecture is intentionally pluggable:
 *
 *   1. Universal filters always run (ANSI strip, progress collapse,
 *      blank-line collapse). These are safe for any command.
 *   2. Command-specific filters opt in by matching the leading token of
 *      the command (e.g. "npm", "git"). They handle their own quirks.
 *
 * Adding a new filter: implement `OutputFilter` and register it in
 * `COMMAND_FILTERS`. Keep filters pure and side-effect free.
 */

import { gitFilter } from "./commands/git";
import { npmFilter } from "./commands/npm";
import { stripAnsi } from "./strip-ansi";
import { universalCleanup } from "./universal";

/**
 * Stateless transform from raw output → cleaned output.
 *
 * Filters MUST be idempotent and never throw.
 */
export type OutputFilter = (output: string) => string;

/**
 * Map from leading-command token (the binary name) to a specific filter.
 * The leading token is the first whitespace-delimited word of the command,
 * stripped of any path prefix (`/usr/local/bin/npm` → `npm`).
 */
const COMMAND_FILTERS: Record<string, OutputFilter> = {
  npm: npmFilter,
  pnpm: npmFilter, // pnpm output is similar enough to share the filter
  yarn: npmFilter,
  bun: npmFilter,
  git: gitFilter,
};

/**
 * Apply the full filter pipeline to the output of a shell command.
 *
 * Order matters:
 *   1. ANSI strip — colour codes confuse downstream regex filters.
 *   2. Universal cleanup — collapses progress bars and excess blank lines.
 *   3. Command-specific filter (if any) — domain-aware noise removal.
 */
export function filterCommandOutput(command: string, output: string): string {
  if (!output) return output;

  let cleaned = stripAnsi(output);
  cleaned = universalCleanup(cleaned);

  const leading = leadingToken(command);
  const specific = leading ? COMMAND_FILTERS[leading] : null;
  if (specific) cleaned = specific(cleaned);

  return cleaned;
}

/**
 * Extract the binary name from a command string. Handles paths and
 * env-prefixed invocations like `NODE_ENV=prod npm run build`.
 */
function leadingToken(command: string): string | null {
  const parts = command.trim().split(/\s+/);
  for (const part of parts) {
    // Skip env assignments (FOO=bar)
    if (/^[A-Z_][A-Z0-9_]*=/.test(part)) continue;
    // Strip any directory prefix and return the binary name
    const slash = part.lastIndexOf("/");
    return slash === -1 ? part : part.slice(slash + 1);
  }
  return null;
}

export { stripAnsi } from "./strip-ansi";
export { universalCleanup } from "./universal";
