/**
 * Retry with exponential backoff and jitter.
 *
 * Wraps async functions so that transient failures (429, 502, 503, network
 * errors) are retried automatically. Reads standard rate-limit headers to
 * determine the optimal wait time before retrying.
 */

import { logger as log } from "../../shared/logger";

// ─── Types ───────────────────────────────────────────────────

export type RetryConfig = {
  /** Maximum number of retry attempts (not counting the initial call). Default: 3. */
  maxRetries: number;
  /** Base delay in ms before first retry. Default: 1000. */
  baseDelayMs: number;
  /** Maximum delay cap in ms. Default: 60_000. */
  maxDelayMs: number;
  /** Random jitter ceiling in ms added to each delay. Default: 500. */
  jitterMs: number;
};

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  jitterMs: 500,
};

/**
 * Information about an HTTP response that the retry logic needs
 * to decide whether and how long to wait.
 */
export type ResponseMeta = {
  status: number;
  headers?: Headers;
};

/**
 * Result of a single attempt — either success with a value,
 * or a retriable/non-retriable failure.
 */
export type AttemptResult<T> =
  | { ok: true; value: T }
  | { ok: false; retriable: boolean; error: Error; responseMeta?: ResponseMeta };

// ─── Header parsing ──────────────────────────────────────────

const RETRIABLE_STATUS_CODES = new Set([429, 502, 503]);
const RETRIABLE_NETWORK_ERRORS = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** Check if an error (typically from fetch) is a transient network error. */
export function isRetriableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code && RETRIABLE_NETWORK_ERRORS.has(code)) return true;
  // Bun/Node fetch wraps network errors in TypeError
  if (error.cause && error.cause instanceof Error) {
    const causeCode = (error.cause as NodeJS.ErrnoException).code;
    if (causeCode && RETRIABLE_NETWORK_ERRORS.has(causeCode)) return true;
  }
  return false;
}

/** Check if an HTTP status code is retriable. */
export function isRetriableStatus(status: number): boolean {
  return RETRIABLE_STATUS_CODES.has(status);
}

/**
 * Parse the `Retry-After` header.
 * Supports both delta-seconds ("120") and HTTP-date ("Wed, 21 Oct 2025 07:28:00 GMT").
 * Returns delay in milliseconds, or null if the header is absent/unparseable.
 */
export function parseRetryAfter(headers: Headers): number | null {
  const value = headers.get("retry-after");
  if (!value) return null;

  // Try as integer seconds first
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  // Try as HTTP-date
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return Math.max(0, delayMs);
  }

  return null;
}

/**
 * Parse provider-specific rate limit reset headers.
 * Checks for: x-ratelimit-reset-requests, x-ratelimit-reset-tokens,
 * anthropic-ratelimit-tokens-reset, etc.
 * Returns the shortest wait in ms, or null.
 */
export function parseRateLimitReset(headers: Headers): number | null {
  const resetHeaders = [
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "anthropic-ratelimit-requests-reset",
    "anthropic-ratelimit-tokens-reset",
  ];

  let shortest: number | null = null;

  for (const name of resetHeaders) {
    const value = headers.get(name);
    if (!value) continue;

    let delayMs: number | null = null;

    // Try as duration string like "1s", "2m30s", "500ms"
    delayMs = parseDuration(value);

    // Try as plain seconds (before Date, because Date("5") parses as year 2005)
    if (delayMs === null) {
      const num = Number(value);
      if (Number.isFinite(num) && num >= 0) {
        delayMs = Math.ceil(num * 1000);
      }
    }

    // Try as ISO timestamp
    if (delayMs === null) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        delayMs = Math.max(0, date.getTime() - Date.now());
      }
    }

    if (delayMs !== null && (shortest === null || delayMs < shortest)) {
      shortest = delayMs;
    }
  }

  return shortest;
}

/** Parse duration strings like "1s", "2m30s", "500ms", "1.5s". */
function parseDuration(value: string): number | null {
  const match = value.match(
    /^(?:(\d+(?:\.\d+)?)ms)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)h)?$/,
  );
  if (!match) {
    // Try reversed order (e.g., "2m30s")
    const reversed = value.match(
      /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/,
    );
    if (!reversed) return null;
    const [, h, m, s, ms] = reversed;
    if (!h && !m && !s && !ms) return null;
    return (
      (h ? Number.parseFloat(h) * 3_600_000 : 0) +
      (m ? Number.parseFloat(m) * 60_000 : 0) +
      (s ? Number.parseFloat(s) * 1_000 : 0) +
      (ms ? Number.parseFloat(ms) : 0)
    );
  }
  const [, ms, s, m, h] = match;
  if (!ms && !s && !m && !h) return null;
  return (
    (ms ? Number.parseFloat(ms) : 0) +
    (s ? Number.parseFloat(s) * 1_000 : 0) +
    (m ? Number.parseFloat(m) * 60_000 : 0) +
    (h ? Number.parseFloat(h) * 3_600_000 : 0)
  );
}

// ─── Core retry logic ────────────────────────────────────────

/**
 * Calculate the delay before the next retry attempt.
 * Priority: Retry-After header > rate-limit reset headers > exponential backoff.
 */
export function computeDelay(
  attempt: number,
  config: RetryConfig,
  responseMeta?: ResponseMeta,
): number {
  // 1. Check headers for server-specified delay
  if (responseMeta?.headers) {
    const retryAfter = parseRetryAfter(responseMeta.headers);
    if (retryAfter !== null) return Math.min(retryAfter, config.maxDelayMs);

    const resetDelay = parseRateLimitReset(responseMeta.headers);
    if (resetDelay !== null) return Math.min(resetDelay, config.maxDelayMs);
  }

  // 2. Exponential backoff with jitter
  const exponential = config.baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * config.jitterMs;
  return Math.min(exponential + jitter, config.maxDelayMs);
}

/**
 * Execute an async function with automatic retries on transient failures.
 *
 * The `fn` receives the current attempt number (0-based) and must return
 * an `AttemptResult<T>` indicating success or failure with retriability info.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<AttemptResult<T>>,
  config: Partial<RetryConfig> = {},
  signal?: AbortSignal,
): Promise<AttemptResult<T>> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastResult: AttemptResult<T> | null = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    // Check abort before each attempt
    if (signal?.aborted) {
      return {
        ok: false,
        retriable: false,
        error: new Error("Request aborted"),
      };
    }

    lastResult = await fn(attempt);

    if (lastResult.ok) return lastResult;
    if (!lastResult.retriable) return lastResult;
    if (attempt === cfg.maxRetries) return lastResult;

    // Calculate and apply delay
    const delayMs = computeDelay(attempt, cfg, lastResult.responseMeta);
    log.warn("retrying request", {
      attempt: attempt + 1,
      maxRetries: cfg.maxRetries,
      delayMs: Math.round(delayMs),
      status: lastResult.responseMeta?.status,
      error: lastResult.error.message,
    });

    await sleep(delayMs, signal);
  }

  // lastResult is always set because maxRetries >= 0 and the loop runs at least once
  return lastResult as AttemptResult<T>;
}

/** Sleep that can be interrupted by an abort signal. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
