/**
 * Interactive slash-command autocomplete.
 *
 * Renders a filtered menu below the prompt as the user types.
 * Tab accepts the selected entry, Up/Down navigate, Esc dismisses.
 */
import type { Interface as ReadlineInterface } from "node:readline";
import type { CompletionEntry } from "./slash-commands";

const MAX_VISIBLE = 8;

const ESC = "\x1b";
const SAVE_CURSOR = `${ESC}7`;
const RESTORE_CURSOR = `${ESC}8`;
const CLEAR_LINE = `${ESC}[2K`;
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

  function getMatches(line: string): CompletionEntry[] {
    if (!line.startsWith("/") || line.includes(" ")) return [];
    const query = line.toLowerCase();
    return entries.filter((e) => e.text.toLowerCase().startsWith(query));
  }

  function clearMenu(): void {
    if (renderedLines === 0) return;
    const out = process.stdout;
    // Move below current line and clear each rendered line
    let buf = SAVE_CURSOR;
    for (let i = 0; i < renderedLines; i++) {
      buf += `\n${CLEAR_LINE}`;
    }
    buf += RESTORE_CURSOR;
    out.write(buf);
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

    let buf = SAVE_CURSOR;
    for (let i = 0; i < visible.length; i++) {
      const entry = visible[i] as CompletionEntry;
      const isSelected = i === selectedIndex;
      const pointer = isSelected ? `${CYAN}▸${RESET}` : " ";
      const name = isSelected ? `${BOLD}${entry.text}${RESET}` : entry.text;
      const alias = entry.aliasOf ? `${DIM} → /${entry.aliasOf}${RESET}` : "";
      const desc = `${DIM}${entry.description}${RESET}`;
      buf += `\n${CLEAR_LINE}  ${pointer} ${name}${alias}  ${desc}`;
    }
    if (matches.length > MAX_VISIBLE) {
      buf += `\n${CLEAR_LINE}  ${DIM}  … ${matches.length - MAX_VISIBLE} more${RESET}`;
      renderedLines = visible.length + 1;
    } else {
      renderedLines = visible.length;
    }
    buf += RESTORE_CURSOR;
    out.write(buf);
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
