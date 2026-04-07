/**
 * Funny "thinking…" messages for the REPL spinner.
 *
 * Design goals:
 * - **Variety**: a long pool so users don't see the same word twice in a row.
 * - **Tone**: light, witty, never condescending; safe across cultures.
 * - **Stable**: deterministic shuffling per session via a small RNG so we
 *   never repeat the same message in consecutive draws.
 * - **No state leakage**: a `ThinkingPool` instance carries its own
 *   "recently used" set, scoped to a single REPL run.
 *
 * The pool is loosely categorized so future code can request a tone
 * (e.g. "thinking" vs. "still thinking" for very long waits) without
 * touching the message list.
 */

/** Short, punchy verbs for the early phase of a wait. */
const THINKING: readonly string[] = [
  "Pondering",
  "Cogitating",
  "Brewing thoughts",
  "Wrangling neurons",
  "Consulting the oracle",
  "Reticulating splines",
  "Untangling logic",
  "Rolling the dice",
  "Polling the muses",
  "Negotiating with bytes",
  "Sharpening pencils",
  "Asking nicely",
  "Doing the math",
  "Compiling vibes",
  "Spinning up",
  "Reading the room",
  "Triangulating",
  "Looking under the rug",
  "Searching the couch cushions",
  "Whispering to the LLM",
  "Aligning the stars",
  "Defragmenting ideas",
  "Brewing espresso",
  "Wiggling neurons",
  "Tickling tensors",
  "Plotting course",
  "Doing the heavy lifting",
  "Crunching context",
  "Knitting tokens",
  "Greasing the gears",
];

/** For longer waits — slightly more self-aware. */
const STILL_THINKING: readonly string[] = [
  "Still thinking",
  "Taking the scenic route",
  "Definitely not stuck",
  "Almost there, probably",
  "Counting to a million",
  "Re-reading the prompt",
  "Calling my therapist",
  "Untangling the spaghetti",
  "Checking with legal",
  "Consulting a second opinion",
  "Re-checking my work",
  "Found something interesting",
  "Negotiating with myself",
  "Drawing diagrams",
  "Playing 4D chess",
  "Going down a rabbit hole",
  "Loading more context",
  "Doing one more pass",
];

/** For *very* long waits — gentle reassurance. */
const LONG_WAIT: readonly string[] = [
  "Big task — bear with me",
  "This one's a thinker",
  "Quality takes time",
  "Worth the wait, I promise",
  "Drafting the perfect reply",
  "Earning my keep",
];

export type ThinkingTone = "thinking" | "still" | "long";

/**
 * A session-scoped pool of thinking messages.
 *
 * Use a single instance per REPL run. `next()` is guaranteed not to
 * return the same message twice in a row, and avoids repeats within a
 * sliding window (size = pool length / 4) so users see real variety.
 */
export type ThinkingPool = {
  /** Get the next message for the given tone. */
  next(tone?: ThinkingTone): string;
  /** Reset the recent-history window. */
  reset(): void;
};

export function createThinkingPool(): ThinkingPool {
  // Recently used messages, used to avoid near-term repetition.
  const recent: string[] = [];
  const RECENT_LIMIT = Math.max(4, Math.floor(THINKING.length / 4));

  function pickFrom(pool: readonly string[]): string {
    // Try a handful of times to find a message not in the recent window.
    for (let attempt = 0; attempt < 8; attempt++) {
      const idx = Math.floor(Math.random() * pool.length);
      const candidate = pool[idx]!;
      if (!recent.includes(candidate)) {
        recent.push(candidate);
        if (recent.length > RECENT_LIMIT) recent.shift();
        return candidate;
      }
    }
    // Fall back: just return any message (and refresh history).
    const fallback = pool[Math.floor(Math.random() * pool.length)]!;
    recent.length = 0;
    recent.push(fallback);
    return fallback;
  }

  return {
    next(tone: ThinkingTone = "thinking"): string {
      switch (tone) {
        case "still":
          return pickFrom(STILL_THINKING);
        case "long":
          return pickFrom(LONG_WAIT);
        default:
          return pickFrom(THINKING);
      }
    },
    reset() {
      recent.length = 0;
    },
  };
}

/**
 * Decide which tone to use given how long the agent has been thinking.
 * The thresholds are deliberately generous: we never want a user to feel
 * the assistant is making excuses too early.
 */
export function toneForElapsed(elapsedMs: number): ThinkingTone {
  if (elapsedMs > 30_000) return "long";
  if (elapsedMs > 8_000) return "still";
  return "thinking";
}
