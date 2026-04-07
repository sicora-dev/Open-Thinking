/**
 * Strip ANSI escape sequences (colour codes, cursor movement, etc.)
 * from a string. These bytes carry no information for the LLM and
 * inflate token cost considerably for any TTY-aware command.
 *
 * Pattern adapted from the well-known `ansi-regex` package, kept
 * inline so the project remains dependency-free for this concern.
 */
const ANSI_PATTERN = new RegExp(
  [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
  ].join("|"),
  "g",
);

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}
