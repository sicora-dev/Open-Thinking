/**
 * Live token / cost meter for the REPL.
 *
 * Renders a single status line that updates in place during pipeline
 * execution, similar to Claude Code's status row. The line shows:
 *
 *   ⠋ Pondering   coder · gpt-4o   12,431 tok · $0.0421   8.2s
 *
 * Architecture
 * ------------
 * The meter is **owned by the REPL** and only attached during a pipeline
 * run. It listens to the event bus for `tokens:update`, `thinking:start`,
 * `thinking:end`, `stage:start`, and `stage:complete` events.
 *
 * Rendering uses ANSI escape codes (`\r` + clear-to-end-of-line). To
 * avoid stomping on regular `console.log` output from the rest of the
 * REPL, the meter exposes `withQuietZone(fn)` — anything inside that
 * callback gets a clean line first, and the meter redraws afterwards.
 *
 * Production notes
 * ----------------
 * - **TTY-aware**: when stdout is not a TTY (CI logs, file redirects),
 *   `start()` becomes a no-op so we don't pollute logs with spinner
 *   frames. The meter still tracks state internally so the final
 *   summary is accurate.
 * - **Bounded redraw rate**: capped at ~10fps via a setInterval timer
 *   to avoid burning CPU on fast token streams.
 * - **Single instance**: there is no global state; multiple REPLs in
 *   the same process get independent meters.
 */

import type { EventBus } from "../../core/events/event-bus";
import { estimateCost, formatCost, isLocalProvider } from "../../providers/pricing";
import type { TokenBreakdown, TokenUsage } from "../../shared/types";
import { type ThinkingPool, createThinkingPool, toneForElapsed } from "./thinking-messages";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
};

type StageState = {
  stageName: string;
  model: string;
  providerType: string;
  iteration: number;
  usage: TokenUsage;
  breakdown: TokenBreakdown;
};

export type TokenMeter = {
  /** Begin rendering the meter. No-op on non-TTY stdout. */
  start(): void;
  /** Stop rendering and detach event listeners. Idempotent. */
  stop(): void;
  /**
   * Run a callback with the meter temporarily cleared, so caller-printed
   * lines don't collide with the spinner. The meter resumes after.
   */
  withQuietZone<T>(fn: () => T): T;
  /** Snapshot of the cumulative usage across all stages so far. */
  totals(): { usage: TokenUsage; cost: number | null };
};

export type CreateTokenMeterOptions = {
  eventBus: EventBus;
  /** Output stream — defaults to process.stdout, but tests can pass a mock. */
  out?: NodeJS.WriteStream;
};

export function createTokenMeter(opts: CreateTokenMeterOptions): TokenMeter {
  const out = opts.out ?? process.stdout;
  const isTty = Boolean(out.isTTY);

  // Cumulative across the entire pipeline run.
  const cumulativeUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  let cumulativeCost = 0;
  let cumulativeCostKnown = true; // becomes false if any stage uses an unpriced model

  const stages = new Map<string, StageState>();
  let currentStage: string | null = null;
  let thinking = false;
  const thinkingPool: ThinkingPool = createThinkingPool();
  let thinkingMessage = "";
  let thinkingStartedAt = 0;
  let thinkingMessageRotatedAt = 0;
  let frame = 0;
  let runStart = Date.now();

  let timer: ReturnType<typeof setInterval> | null = null;
  let lineDrawn = false;
  let unsubs: Array<() => void> = [];

  function clearLine(): void {
    if (!isTty) return;
    if (!lineDrawn) return;
    out.write("\r\x1b[2K");
    lineDrawn = false;
  }

  function formatNumber(n: number): string {
    return n.toLocaleString("en-US");
  }

  function elapsed(): string {
    const sec = (Date.now() - runStart) / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}m${s}s`;
  }

  function buildLine(): string {
    const stage = currentStage ? stages.get(currentStage) : null;

    const spinner = `${COLORS.cyan}${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]}${COLORS.reset}`;

    const verb = thinking
      ? `${COLORS.magenta}${thinkingMessage}…${COLORS.reset}`
      : stage
        ? `${COLORS.green}working${COLORS.reset}`
        : `${COLORS.dim}idle${COLORS.reset}`;

    const stagePart = stage
      ? `${COLORS.dim}·${COLORS.reset} ${stage.stageName} ${COLORS.dim}(${stage.model})${COLORS.reset}`
      : "";

    const tokens = `${COLORS.dim}·${COLORS.reset} ${formatNumber(cumulativeUsage.totalTokens)} tok`;
    const costLabel = cumulativeCostKnown ? formatCost(cumulativeCost) : "$—";
    const cost = `${COLORS.dim}·${COLORS.reset} ${costLabel}`;
    const time = `${COLORS.dim}· ${elapsed()}${COLORS.reset}`;

    return `  ${spinner} ${verb} ${stagePart} ${tokens} ${cost} ${time}`;
  }

  function redraw(): void {
    if (!isTty) return;
    clearLine();
    out.write(buildLine());
    lineDrawn = true;
  }

  function tick(): void {
    if (!thinking) return;
    frame++;

    // Rotate thinking message every ~3.5s and bump the tone over time.
    const now = Date.now();
    if (now - thinkingMessageRotatedAt > 3500) {
      const tone = toneForElapsed(now - thinkingStartedAt);
      thinkingMessage = thinkingPool.next(tone);
      thinkingMessageRotatedAt = now;
    }
    redraw();
  }

  function recordUsage(state: StageState, prev: StageState | undefined): void {
    // Compute the *delta* the new sample contributes to the cumulative
    // total. Stage updates are absolute (full per-stage usage), so we
    // subtract the previous snapshot for that same stage.
    const dPrompt = state.usage.promptTokens - (prev?.usage.promptTokens ?? 0);
    const dCompletion = state.usage.completionTokens - (prev?.usage.completionTokens ?? 0);
    const dTotal = state.usage.totalTokens - (prev?.usage.totalTokens ?? 0);
    cumulativeUsage.promptTokens += dPrompt;
    cumulativeUsage.completionTokens += dCompletion;
    cumulativeUsage.totalTokens += dTotal;

    const local = isLocalProvider(state.providerType);
    const stageCostNow = estimateCost(state.usage, state.model, local);
    const stageCostPrev = prev ? estimateCost(prev.usage, prev.model, local) : 0;
    if (stageCostNow === null) {
      cumulativeCostKnown = false;
    } else if (stageCostPrev !== null) {
      cumulativeCost += stageCostNow - stageCostPrev;
    }
  }

  function attach(): void {
    unsubs.push(
      opts.eventBus.on("pipeline:start", () => {
        runStart = Date.now();
        cumulativeUsage.promptTokens = 0;
        cumulativeUsage.completionTokens = 0;
        cumulativeUsage.totalTokens = 0;
        cumulativeCost = 0;
        cumulativeCostKnown = true;
        stages.clear();
        currentStage = null;
        thinking = false;
        redraw();
      }),
    );

    unsubs.push(
      opts.eventBus.on("stage:start", (e) => {
        if (e.type !== "stage:start") return;
        currentStage = e.stageName;
        redraw();
      }),
    );

    unsubs.push(
      opts.eventBus.on("thinking:start", (e) => {
        if (e.type !== "thinking:start") return;
        thinking = true;
        thinkingStartedAt = Date.now();
        thinkingMessage = thinkingPool.next("thinking");
        thinkingMessageRotatedAt = thinkingStartedAt;
        redraw();
      }),
    );

    unsubs.push(
      opts.eventBus.on("thinking:end", (e) => {
        if (e.type !== "thinking:end") return;
        thinking = false;
        redraw();
      }),
    );

    unsubs.push(
      opts.eventBus.on("tokens:update", (e) => {
        if (e.type !== "tokens:update") return;
        const prev = stages.get(e.stageName);
        const state: StageState = {
          stageName: e.stageName,
          model: e.model,
          providerType: e.providerType,
          iteration: e.iteration,
          usage: e.usage,
          breakdown: e.breakdown,
        };
        recordUsage(state, prev);
        stages.set(e.stageName, state);
        redraw();
      }),
    );

    unsubs.push(
      opts.eventBus.on("stage:complete", (e) => {
        if (e.type !== "stage:complete") return;
        if (currentStage === e.result.stageName) {
          currentStage = null;
          thinking = false;
        }
        redraw();
      }),
    );
  }

  return {
    start() {
      attach();
      if (!isTty) return;
      runStart = Date.now();
      timer = setInterval(tick, 100);
      redraw();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      clearLine();
      for (const u of unsubs) u();
      unsubs = [];
    },
    withQuietZone<T>(fn: () => T): T {
      clearLine();
      try {
        return fn();
      } finally {
        if (isTty && (currentStage || thinking)) {
          redraw();
        }
      }
    },
    totals() {
      return {
        usage: { ...cumulativeUsage },
        cost: cumulativeCostKnown ? cumulativeCost : null,
      };
    },
  };
}
