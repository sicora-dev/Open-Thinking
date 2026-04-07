/**
 * git output filter.
 *
 * Removes pager hints, "hint:" advice lines (which are aimed at human
 * users), and trailing remote-fetch progress that survived the
 * universal cleanup.
 */

const NOISE_PATTERNS: RegExp[] = [
  /^hint: /i,
  /^Receiving objects:/i,
  /^Resolving deltas:/i,
  /^remote: Counting objects:/i,
  /^remote: Compressing objects:/i,
  /^remote: Total /i,
  /^Unpacking objects:/i,
];

export function gitFilter(input: string): string {
  return input
    .split("\n")
    .filter((line) => !NOISE_PATTERNS.some((re) => re.test(line)))
    .join("\n");
}
