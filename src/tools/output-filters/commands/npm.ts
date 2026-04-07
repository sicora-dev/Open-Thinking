/**
 * npm / pnpm / yarn / bun output filter.
 *
 * Removes the chatter that npm-family tools emit during install/run:
 *   - download progress (`http fetch GET ...`)
 *   - deprecation warnings (`npm WARN deprecated ...`)
 *   - funding / audit nags
 *   - bun's per-package "installing" lines
 *
 * Errors and the actual command output are preserved.
 */

const NOISE_PATTERNS: RegExp[] = [
  /^npm (warn|notice|info)\b/i,
  /^npm WARN deprecated/i,
  /^npm fund/i,
  /^npm audit/i,
  /^\s*added \d+ packages?/i,
  /^\s*\d+ packages? are looking for funding/i,
  /^\s*run `npm fund`/i,
  /^http fetch /i,
  /^\s*\(node:\d+\) \[?DEP\d+/i, // DeprecationWarning preamble
  /^\s*\(Use `node --trace-/i,
  /^\s*\+ \S+@/, // yarn progress
  /^info /i, // pnpm info lines
  /^\s*Progress:/i, // yarn 1
];

export function npmFilter(input: string): string {
  return input
    .split("\n")
    .filter((line) => !NOISE_PATTERNS.some((re) => re.test(line)))
    .join("\n");
}
