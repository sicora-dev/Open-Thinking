/**
 * UI autostart bootstrap.
 *
 * Behavior:
 *   - First run (autostart undefined): prompt the user yes/no, persist the answer.
 *   - autostart === true: silently start the UI in the background if not already running.
 *   - autostart === false: do nothing.
 *
 * Called from the REPL bootstrap. Never throws — autostart failure is non-fatal.
 */
import * as readline from "node:readline/promises";
import { getUiAutostart, setUiAutostart } from "../config/ui-config";
import { startUi } from "./server/lifecycle";
import { readLock } from "./server/lock";

const COLORS = {
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

async function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultYes ? "(Y/n)" : "(y/N)";
    const answer = (await rl.question(`${question} ${suffix} `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer.startsWith("y");
  } finally {
    rl.close();
  }
}

export async function maybeAutostartUi(): Promise<void> {
  const pref = getUiAutostart();

  // First run — ask
  if (pref === undefined) {
    console.log(
      `\n  ${COLORS.cyan}OpenThinking has a web UI${COLORS.reset} to manage pipelines visually and watch runs in real time.`,
    );
    let wantsAutostart = false;
    try {
      wantsAutostart = await promptYesNo(
        "  Start it automatically every time you launch openthk?",
        true,
      );
    } catch {
      // Non-interactive (CI, piped stdin) — default to off, don't persist
      return;
    }
    setUiAutostart(wantsAutostart);
    if (!wantsAutostart) {
      console.log(
        `  ${COLORS.dim}Use /ui start to launch it manually, or /ui autostart on later.${COLORS.reset}\n`,
      );
      return;
    }
    // fall through to start it now
  } else if (pref === false) {
    return;
  }

  // pref === true (or just opted in) — start in background if not already running
  const existing = readLock();
  if (existing) {
    return; // already running
  }

  const result = await startUi({});
  if (!result.ok) {
    console.error(`  ${COLORS.dim}UI autostart failed: ${result.error.message}${COLORS.reset}`);
    return;
  }
  console.log(
    `  ${COLORS.cyan}✓${COLORS.reset} UI running at http://127.0.0.1:${result.value.port}`,
  );
}
