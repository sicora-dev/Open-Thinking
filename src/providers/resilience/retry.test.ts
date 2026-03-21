import { describe, expect, mock, test } from "bun:test";
import {
  type AttemptResult,
  DEFAULT_RETRY_CONFIG,
  computeDelay,
  isRetriableNetworkError,
  isRetriableStatus,
  parseRateLimitReset,
  parseRetryAfter,
  withRetry,
} from "./retry";

// ─── isRetriableStatus ───────────────────────────────────────

describe("isRetriableStatus", () => {
  test("429, 502, 503 are retriable", () => {
    expect(isRetriableStatus(429)).toBe(true);
    expect(isRetriableStatus(502)).toBe(true);
    expect(isRetriableStatus(503)).toBe(true);
  });

  test("400, 401, 403, 404, 500 are NOT retriable", () => {
    expect(isRetriableStatus(400)).toBe(false);
    expect(isRetriableStatus(401)).toBe(false);
    expect(isRetriableStatus(403)).toBe(false);
    expect(isRetriableStatus(404)).toBe(false);
    expect(isRetriableStatus(500)).toBe(false);
  });
});

// ─── isRetriableNetworkError ─────────────────────────────────

describe("isRetriableNetworkError", () => {
  test("recognizes ETIMEDOUT", () => {
    const error = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    expect(isRetriableNetworkError(error)).toBe(true);
  });

  test("recognizes ECONNRESET", () => {
    const error = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    expect(isRetriableNetworkError(error)).toBe(true);
  });

  test("recognizes nested cause code", () => {
    const cause = Object.assign(new Error("inner"), { code: "ECONNREFUSED" });
    const error = new TypeError("fetch failed", { cause });
    expect(isRetriableNetworkError(error)).toBe(true);
  });

  test("non-Error values are not retriable", () => {
    expect(isRetriableNetworkError("string error")).toBe(false);
    expect(isRetriableNetworkError(null)).toBe(false);
  });

  test("random errors are not retriable", () => {
    expect(isRetriableNetworkError(new Error("something else"))).toBe(false);
  });
});

// ─── parseRetryAfter ─────────────────────────────────────────

describe("parseRetryAfter", () => {
  test("parses integer seconds", () => {
    const headers = new Headers({ "retry-after": "30" });
    expect(parseRetryAfter(headers)).toBe(30_000);
  });

  test("parses decimal seconds", () => {
    const headers = new Headers({ "retry-after": "1.5" });
    expect(parseRetryAfter(headers)).toBe(1500);
  });

  test("returns null when header absent", () => {
    const headers = new Headers();
    expect(parseRetryAfter(headers)).toBeNull();
  });

  test("parses HTTP-date format", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const headers = new Headers({ "retry-after": future });
    const result = parseRetryAfter(headers);
    expect(result).not.toBeNull();
    // Should be approximately 5000ms (allow 2s tolerance for test execution)
    if (result === null) return; // guard for lint
    expect(result).toBeGreaterThan(3000);
    expect(result).toBeLessThanOrEqual(6000);
  });

  test("returns null for garbage value", () => {
    const headers = new Headers({ "retry-after": "not-a-number-or-date" });
    expect(parseRetryAfter(headers)).toBeNull();
  });
});

// ─── parseRateLimitReset ─────────────────────────────────────

describe("parseRateLimitReset", () => {
  test("parses duration string from x-ratelimit-reset-requests", () => {
    const headers = new Headers({ "x-ratelimit-reset-requests": "2s" });
    expect(parseRateLimitReset(headers)).toBe(2000);
  });

  test("parses compound duration like 2m30s", () => {
    const headers = new Headers({ "x-ratelimit-reset-tokens": "2m30s" });
    expect(parseRateLimitReset(headers)).toBe(150_000);
  });

  test("returns shortest of multiple headers", () => {
    const headers = new Headers({
      "x-ratelimit-reset-requests": "1s",
      "x-ratelimit-reset-tokens": "30s",
    });
    expect(parseRateLimitReset(headers)).toBe(1000);
  });

  test("returns null when no rate limit headers", () => {
    const headers = new Headers({ "content-type": "application/json" });
    expect(parseRateLimitReset(headers)).toBeNull();
  });

  test("parses plain seconds", () => {
    const headers = new Headers({ "anthropic-ratelimit-requests-reset": "5" });
    expect(parseRateLimitReset(headers)).toBe(5000);
  });
});

// ─── computeDelay ────────────────────────────────────────────

describe("computeDelay", () => {
  test("uses Retry-After header when present", () => {
    const headers = new Headers({ "retry-after": "10" });
    const delay = computeDelay(0, DEFAULT_RETRY_CONFIG, { status: 429, headers });
    expect(delay).toBe(10_000);
  });

  test("caps header delay at maxDelayMs", () => {
    const headers = new Headers({ "retry-after": "120" });
    const delay = computeDelay(0, DEFAULT_RETRY_CONFIG, { status: 429, headers });
    expect(delay).toBe(DEFAULT_RETRY_CONFIG.maxDelayMs);
  });

  test("uses exponential backoff without headers", () => {
    const delay0 = computeDelay(0, { ...DEFAULT_RETRY_CONFIG, jitterMs: 0 });
    const delay1 = computeDelay(1, { ...DEFAULT_RETRY_CONFIG, jitterMs: 0 });
    const delay2 = computeDelay(2, { ...DEFAULT_RETRY_CONFIG, jitterMs: 0 });

    expect(delay0).toBe(1000); // 1000 * 2^0
    expect(delay1).toBe(2000); // 1000 * 2^1
    expect(delay2).toBe(4000); // 1000 * 2^2
  });

  test("caps exponential at maxDelayMs", () => {
    const delay = computeDelay(20, { ...DEFAULT_RETRY_CONFIG, jitterMs: 0 });
    expect(delay).toBe(DEFAULT_RETRY_CONFIG.maxDelayMs);
  });

  test("adds jitter within bounds", () => {
    const delays = Array.from({ length: 100 }, () => computeDelay(0, DEFAULT_RETRY_CONFIG));
    // All should be between baseDelay and baseDelay + jitter
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(DEFAULT_RETRY_CONFIG.baseDelayMs);
      expect(d).toBeLessThanOrEqual(
        DEFAULT_RETRY_CONFIG.baseDelayMs + DEFAULT_RETRY_CONFIG.jitterMs,
      );
    }
  });
});

// ─── withRetry ───────────────────────────────────────────────

describe("withRetry", () => {
  test("returns immediately on success", async () => {
    const fn = mock(() => Promise.resolve<AttemptResult<string>>({ ok: true, value: "done" }));

    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("done");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retries on retriable failure and succeeds", async () => {
    let calls = 0;
    const fn = mock((): Promise<AttemptResult<string>> => {
      calls++;
      if (calls < 3) {
        return Promise.resolve({
          ok: false,
          retriable: true,
          error: new Error("rate limited"),
          responseMeta: { status: 429 },
        });
      }
      return Promise.resolve({ ok: true, value: "recovered" });
    });

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
      jitterMs: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("does not retry on non-retriable failure", async () => {
    const fn = mock(
      (): Promise<AttemptResult<string>> =>
        Promise.resolve({
          ok: false,
          retriable: false,
          error: new Error("auth failed"),
          responseMeta: { status: 401 },
        }),
    );

    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("gives up after maxRetries", async () => {
    const fn = mock(
      (): Promise<AttemptResult<string>> =>
        Promise.resolve({
          ok: false,
          retriable: true,
          error: new Error("still failing"),
          responseMeta: { status: 503 },
        }),
    );

    const result = await withRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 10,
      jitterMs: 0,
    });
    expect(result.ok).toBe(false);
    // initial + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const fn = mock(
      (): Promise<AttemptResult<string>> =>
        Promise.resolve({ ok: true, value: "should not reach" }),
    );

    const result = await withRetry(fn, { maxRetries: 3 }, controller.signal);
    expect(result.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(0);
  });

  test("passes attempt number to fn", async () => {
    const attempts: number[] = [];
    const fn = mock((attempt: number): Promise<AttemptResult<string>> => {
      attempts.push(attempt);
      if (attempt < 2) {
        return Promise.resolve({
          ok: false,
          retriable: true,
          error: new Error("fail"),
        });
      }
      return Promise.resolve({ ok: true, value: "done" });
    });

    await withRetry(fn, { maxRetries: 3, baseDelayMs: 10, jitterMs: 0 });
    expect(attempts).toEqual([0, 1, 2]);
  });
});
