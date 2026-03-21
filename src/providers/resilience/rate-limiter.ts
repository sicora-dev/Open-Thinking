/**
 * Token bucket rate limiter for LLM provider requests.
 *
 * Prevents 429 errors by throttling outgoing requests to stay within
 * known provider rate limits. Each provider gets its own bucket.
 *
 * The token bucket algorithm: a bucket holds N tokens (= RPM). Tokens
 * refill at a constant rate (RPM / 60 per second). Each request consumes
 * one token. If no tokens are available, the caller waits until one refills.
 */

import { logger as log } from "../../shared/logger";

// ─── Types ───────────────────────────────────────────────────

export type RateLimiterConfig = {
  /** Requests per minute. */
  rpm: number;
  /** Optional name for logging. */
  name?: string;
};

export type RateLimiter = {
  /** Wait until a token is available, then consume it. */
  acquire(signal?: AbortSignal): Promise<void>;
  /** Try to consume a token immediately. Returns false if none available. */
  tryAcquire(): boolean;
  /** Current number of available tokens (fractional — refill is continuous). */
  availableTokens(): number;
  /** Reset the bucket to full capacity. */
  reset(): void;
};

// ─── Token Bucket ────────────────────────────────────────────

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const { rpm, name = "unknown" } = config;

  // Tokens refill at this rate (tokens per ms)
  const refillRatePerMs = rpm / 60_000;

  // Bucket state
  let tokens = rpm; // Start full
  let lastRefill = Date.now();

  // FIFO queue of callers waiting for a token
  const waitQueue: Array<{
    resolve: () => void;
    cleanup: () => void;
  }> = [];

  /** Refill tokens based on elapsed time since last refill. */
  function refill(): void {
    const now = Date.now();
    const elapsed = now - lastRefill;
    if (elapsed <= 0) return;

    tokens = Math.min(rpm, tokens + elapsed * refillRatePerMs);
    lastRefill = now;
  }

  /** How many ms until the next token is available. */
  function msUntilToken(): number {
    if (tokens >= 1) return 0;
    const deficit = 1 - tokens;
    return Math.ceil(deficit / refillRatePerMs);
  }

  /** Try to drain the wait queue if tokens are available. */
  function drainQueue(): void {
    refill();
    while (waitQueue.length > 0 && tokens >= 1) {
      tokens -= 1;
      const waiter = waitQueue.shift();
      if (!waiter) break;
      waiter.cleanup();
      waiter.resolve();
    }

    // If there are still waiters, schedule the next drain
    if (waitQueue.length > 0) {
      const waitMs = msUntilToken();
      setTimeout(drainQueue, Math.max(1, waitMs));
    }
  }

  function tryAcquire(): boolean {
    refill();
    if (tokens >= 1) {
      tokens -= 1;
      return true;
    }
    return false;
  }

  function acquire(signal?: AbortSignal): Promise<void> {
    // Fast path: token available
    if (tryAcquire()) return Promise.resolve();

    const waitMs = msUntilToken();
    log.debug("rate limiter waiting", { provider: name, waitMs, queueDepth: waitQueue.length });

    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Rate limiter acquire aborted"));
        return;
      }

      let timer: ReturnType<typeof setTimeout> | null = null;

      const onAbort = () => {
        // Remove from queue
        const idx = waitQueue.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) waitQueue.splice(idx, 1);
        if (timer) clearTimeout(timer);
        reject(new Error("Rate limiter acquire aborted"));
      };

      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        if (timer) clearTimeout(timer);
      };

      signal?.addEventListener("abort", onAbort, { once: true });

      waitQueue.push({ resolve, cleanup });

      // Schedule a drain for when the next token should be available
      if (waitQueue.length === 1) {
        timer = setTimeout(drainQueue, Math.max(1, waitMs));
      }
    });
  }

  function availableTokens(): number {
    refill();
    return tokens;
  }

  function reset(): void {
    tokens = rpm;
    lastRefill = Date.now();
  }

  return { acquire, tryAcquire, availableTokens, reset };
}

// ─── Provider Registry ───────────────────────────────────────

/**
 * Known default RPM limits per provider.
 * These are conservative estimates for the lowest common tier.
 * Users can override via provider config.
 */
export const PROVIDER_DEFAULT_RPM: Record<string, number> = {
  openai: 500,
  anthropic: 50,
  google: 360,
  mistral: 120,
  xai: 60,
  deepseek: 60,
  groq: 30,
  together: 600,
  fireworks: 600,
  openrouter: 200,
  perplexity: 50,
  cohere: 100,
  // Local providers get high limits — they're not rate limited by a remote API
  ollama: 10_000,
  lmstudio: 10_000,
  llamacpp: 10_000,
};

const registry = new Map<string, RateLimiter>();

/**
 * Get or create a rate limiter for a provider.
 * If `rpm` is provided, it overrides the default for this provider.
 */
export function getRateLimiter(providerName: string, rpm?: number): RateLimiter {
  const key = providerName;
  let limiter = registry.get(key);
  if (limiter) return limiter;

  const effectiveRpm = rpm ?? PROVIDER_DEFAULT_RPM[providerName] ?? 200;
  limiter = createRateLimiter({ rpm: effectiveRpm, name: providerName });
  registry.set(key, limiter);

  log.debug("created rate limiter", { provider: providerName, rpm: effectiveRpm });
  return limiter;
}

/** Clear all registered rate limiters. Useful for testing. */
export function clearRateLimiters(): void {
  registry.clear();
}

// ─── TPM (Tokens Per Minute) Limiter ─────────────────────────

/**
 * Sliding-window token-per-minute limiter.
 *
 * Unlike the RPM bucket (which counts requests), this tracks actual token
 * consumption over a rolling 60-second window and pauses outgoing requests
 * when the next call would exceed the provider's TPM ceiling.
 *
 * The limit self-calibrates: after the first response, `updateFromHeaders`
 * reads the real limit from provider headers (x-ratelimit-limit-tokens,
 * anthropic-ratelimit-tokens-limit, etc.), replacing the conservative default.
 */
export type TpmLimiter = {
  /** Wait if sending `estimatedTokens` would exceed the TPM limit. */
  acquire(estimatedTokens: number, signal?: AbortSignal): Promise<void>;
  /** Record actual tokens consumed after a response. */
  record(tokens: number): void;
  /** Read and apply the real TPM limit from response headers. */
  updateFromHeaders(headers: Headers | undefined): void;
  /** Tokens consumed in the current 60s window. */
  currentWindowUsage(): number;
};

type TokenUsageEntry = { timestamp: number; tokens: number };

export function createTpmLimiter(config: { tpm: number; name?: string }): TpmLimiter {
  let tpmLimit = config.tpm;
  const providerName = config.name ?? "unknown";
  const window: TokenUsageEntry[] = [];

  function prune(): void {
    const cutoff = Date.now() - 60_000;
    while (window.length > 0 && (window[0]?.timestamp ?? 0) < cutoff) {
      window.shift();
    }
  }

  function currentWindowUsage(): number {
    prune();
    let total = 0;
    for (const entry of window) total += entry.tokens;
    return total;
  }

  function record(tokens: number): void {
    window.push({ timestamp: Date.now(), tokens });
  }

  function updateFromHeaders(headers: Headers | undefined): void {
    if (!headers) return;

    // OpenAI: x-ratelimit-limit-tokens
    // Anthropic: anthropic-ratelimit-tokens-limit
    const limitHeaders = [
      "x-ratelimit-limit-tokens",
      "anthropic-ratelimit-tokens-limit",
    ];

    for (const header of limitHeaders) {
      const value = headers.get(header);
      if (!value) continue;
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0 && parsed !== tpmLimit) {
        log.debug("TPM limit calibrated from headers", {
          provider: providerName,
          previous: tpmLimit,
          actual: parsed,
          header,
        });
        tpmLimit = parsed;
        return;
      }
    }
  }

  async function acquire(estimatedTokens: number, signal?: AbortSignal): Promise<void> {
    prune();
    const used = currentWindowUsage();
    const available = tpmLimit - used;

    if (estimatedTokens <= available) return;

    // Find how long to wait for enough tokens to age out of the window
    let tokensToFree = estimatedTokens - available;
    let waitUntil = 0;

    for (const entry of window) {
      if (tokensToFree <= 0) break;
      tokensToFree -= entry.tokens;
      waitUntil = entry.timestamp + 60_000;
    }

    const waitMs = Math.max(0, waitUntil - Date.now());
    if (waitMs <= 0) return;

    log.warn("TPM limit approaching, throttling", {
      provider: providerName,
      used,
      limit: tpmLimit,
      estimated: estimatedTokens,
      waitMs: Math.round(waitMs),
    });

    await new Promise<void>((resolve) => {
      if (signal?.aborted) { resolve(); return; }
      const timer = setTimeout(resolve, waitMs);
      signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }

  return { acquire, record, updateFromHeaders, currentWindowUsage };
}

/**
 * Known default TPM limits per provider (conservative, lowest-tier estimates).
 * These are initial values — the limiter self-calibrates from response headers
 * after the first request.
 */
export const PROVIDER_DEFAULT_TPM: Record<string, number> = {
  openai: 200_000,
  anthropic: 80_000,
  google: 1_000_000,
  mistral: 500_000,
  xai: 100_000,
  deepseek: 500_000,
  groq: 100_000,
  together: 1_000_000,
  fireworks: 1_000_000,
  openrouter: 200_000,
  perplexity: 100_000,
  cohere: 300_000,
  // Local providers — effectively unlimited
  ollama: 100_000_000,
  lmstudio: 100_000_000,
  llamacpp: 100_000_000,
};

const tpmRegistry = new Map<string, TpmLimiter>();

/**
 * Get or create a TPM limiter for a provider.
 * If `tpm` is provided, it overrides the default for this provider.
 */
export function getTpmLimiter(providerName: string, tpm?: number): TpmLimiter {
  let limiter = tpmRegistry.get(providerName);
  if (limiter) return limiter;

  const effectiveTpm = tpm ?? PROVIDER_DEFAULT_TPM[providerName] ?? 200_000;
  limiter = createTpmLimiter({ tpm: effectiveTpm, name: providerName });
  tpmRegistry.set(providerName, limiter);

  log.debug("created TPM limiter", { provider: providerName, tpm: effectiveTpm });
  return limiter;
}

/** Clear all registered TPM limiters. Useful for testing. */
export function clearTpmLimiters(): void {
  tpmRegistry.clear();
}
