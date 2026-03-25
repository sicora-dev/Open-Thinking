/**
 * Interactive slash-command autocomplete.
 *
 * Renders a filtered menu below the prompt as the user types.
 * Tab accepts the selected entry, Up/Down navigate, Esc dismisses.
 */
import { clearLine, cursorTo, moveCursor, type Interface as ReadlineInterface } from "node:readline";
import type { CompletionEntry } from "./slash-commands";

const MAX_VISIBLE = 8;

const ESC = "\x1b";
const DIM = `${ESC}[2m`;
const BOLD = `${ESC}[1m`;
const CYAN = `${ESC}[36m`;
const RESET = `${ESC}[0m`;

export type SlashCompletion = {
  /** Call on every keypress to update the menu. Returns true if the key was consumed. */
  handleKeypress: (s: string | undefined, key: KeypressEvent) => boolean;
  /** Clean up (remove listeners, clear menu). */
  destroy: () => void;
};

export type KeypressEvent = {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
};

/**
 * Attach interactive slash completion to a readline interface.
 */
export function attachSlashCompletion(
  rl: ReadlineInterface,
  entries: CompletionEntry[],
): SlashCompletion {
  let renderedLines = 0;
  let selectedIndex = 0;
  let matches: CompletionEntry[] = [];
  let active = false;

  function visibleWidth(text: string): number {
    return text.replace(/\x1b\[[0-9;]*m/g, "").length;
  }

  function countTerminalRows(text: string): number {
    const columns = process.stdout.columns || 80;
    const width = visibleWidth(text);
    return Math.max(1, Math.floor(Math.max(0, width - 1) / columns) + 1);
  }

  function getMatches(line: string): CompletionEntry[] {
    if (!line.startsWith("/") || line.includes(" ")) return [];
    const query = line.toLowerCase();
    return entries.filter((e) => e.text.toLowerCase().startsWith(query));
  }

  function clearMenu(): void {
    if (renderedLines === 0) return;
    const out = process.stdout;
    const cols = typeof rl.getCursorPos === "function" ? rl.getCursorPos().cols : 0;

    for (let i = 0; i < renderedLines; i++) {
      moveCursor(out, 0, 1);
      clearLine(out, 0);
    }
    moveCursor(out, 0, -renderedLines);
    cursorTo(out, cols);
    renderedLines = 0;
  }

  function renderMenu(): void {
    clearMenu();
    if (matches.length === 0) {
      active = false;
      return;
    }

    active = true;
    const visible = matches.slice(0, MAX_VISIBLE);
    const out = process.stdout;
    const cols = typeof rl.getCursorPos === "function" ? rl.getCursorPos().cols : 0;
    const lines: string[] = [];
    for (let i = 0; i < visible.length; i++) {
      const entry = visible[i] as CompletionEntry;
      const isSelected = i === selectedIndex;
      const pointer = isSelected ? `${CYAN}▸${RESET}` : " ";
      const name = isSelected ? `${BOLD}${entry.text}${RESET}` : entry.text;
      const alias = entry.aliasOf ? `${DIM} → /${entry.aliasOf}${RESET}` : "";
      const desc = `${DIM}${entry.description}${RESET}`;
      lines.push(`  ${pointer} ${name}${alias}  ${desc}`);
    }
    if (matches.length > MAX_VISIBLE) {
      lines.push(`  ${DIM}  … ${matches.length - MAX_VISIBLE} more${RESET}`);
    }

    for (const line of lines) {
      out.write(`\n${line}`);
    }

    renderedLines = lines.reduce((sum, line) => sum + countTerminalRows(line), 0);
    moveCursor(out, 0, -renderedLines);
    cursorTo(out, cols);
  }

  function update(): void {
    const line = (rl as unknown as { line: string }).line ?? "";
    matches = getMatches(line);
    // Clamp selection
    if (selectedIndex >= matches.length) {
      selectedIndex = Math.max(0, matches.length - 1);
    }
    if (matches.length > 0) {
      renderMenu();
    } else {
      clearMenu();
      active = false;
    }
  }

  function acceptSelected(): void {
    if (!active || matches.length === 0) return;
    const entry = matches[selectedIndex] as CompletionEntry;
    clearMenu();
    active = false;

    // Replace the current line with the selected command
    const rlAny = rl as unknown as { line: string; cursor: number };
    rlAny.line = entry.text;
    rlAny.cursor = entry.text.length;
    // Redraw the prompt with the new content
    // Use internal _refreshLine to update the display
    const rlInternal = rl as unknown as { _refreshLine: () => void };
    if (typeof rlInternal._refreshLine === "function") {
      rlInternal._refreshLine();
    }
  }

  function handleKeypress(s: string | undefined, key: KeypressEvent): boolean {
    if (!key) {
      update();
      return false;
    }

    // Tab: accept selected completion
    if (key.name === "tab" && active) {
      acceptSelected();
      return true;
    }

    // Right arrow: accept when cursor is at end of line
    if (key.name === "right" && active) {
      const rlAny = rl as unknown as { line: string; cursor: number };
      if (rlAny.cursor === rlAny.line.length) {
        acceptSelected();
        return true;
      }
    }

    // Up/Down: navigate the completion menu
    if (key.name === "up" && active) {
      selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : matches.length - 1;
      renderMenu();
      return true;
    }
    if (key.name === "down" && active) {
      selectedIndex = selectedIndex < matches.length - 1 ? selectedIndex + 1 : 0;
      renderMenu();
      return true;
    }

    // Escape: dismiss menu
    if (key.name === "escape" && active) {
      clearMenu();
      active = false;
      return true;
    }

    // Enter: if menu is active, accept and submit
    if (key.name === "return" && active) {
      acceptSelected();
      // Don't consume — let readline process the Enter to submit the line
      return false;
    }

    // For normal editing keys, clear the menu before readline redraws the prompt.
    // Keeping our custom menu visible while readline rewrites the line causes
    // duplicate prompt rows and ghost lines in some terminals.
    clearMenu();
    active = false;

    // Let readline process first, then rebuild matches from the updated line.
    queueMicrotask(update);
    return false;
  }

  function destroy(): void {
    clearMenu();
    active = false;
  }

  return { handleKeypress, destroy };
}
