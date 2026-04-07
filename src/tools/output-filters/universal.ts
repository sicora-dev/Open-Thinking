/**
 * Universal output cleanups. Safe for any command.
 *
 * - Collapse runs of carriage returns (progress bars).
 * - Collapse 3+ consecutive blank lines down to a single blank line.
 * - Trim trailing whitespace on every line.
 *
 * These transforms are idempotent.
 */

const PROGRESS_BAR_LINE = /[█▓▒░■=─-]{3,}|\[[#=> ]+\]/;

export function universalCleanup(input: string): string {
  // CR-only updates (`\r` without `\n`) are how progress bars overwrite
  // themselves on a TTY. Collapse to the *last* such update so the LLM
  // sees the final state, not every frame.
  let cleaned = input.replace(/[^\n]*\r(?!\n)/g, "");

  // Drop pure progress-bar lines that survived the CR collapse.
  cleaned = cleaned
    .split("\n")
    .filter((line) => !PROGRESS_BAR_LINE.test(line) || line.trim().length > 30)
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");

  // Collapse 3+ blank lines.
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  return cleaned;
}
