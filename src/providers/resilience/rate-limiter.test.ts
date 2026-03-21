import { afterEach, describe, expect, test } from "bun:test";
import {
  PROVIDER_DEFAULT_RPM,
  clearRateLimiters,
  createRateLimiter,
  getRateLimiter,
} from "./rate-limiter";

afterEach(() => {
  clearRateLimiters();
});

// ─── createRateLimiter ───────────────────────────────────────

describe("createRateLimiter", () => {
  test("tryAcquire succeeds up to RPM limit", () => {
    const limiter = createRateLimiter({ rpm: 5, name: "test" });

    // Should succeed 5 times (bucket starts full)
    for (let i = 0; i < 5; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }
    // 6th should fail
    expect(limiter.tryAcquire()).toBe(false);
  });

  test("availableTokens decreases after tryAcquire", () => {
    const limiter = createRateLimiter({ rpm: 10, name: "test" });
    expect(limiter.availableTokens()).toBe(10);

    limiter.tryAcquire();
    // Allow tiny floating point from refill
    expect(limiter.availableTokens()).toBeLessThan(10);
    expect(limiter.availableTokens()).toBeGreaterThanOrEqual(9);
  });

  test("reset restores full capacity", () => {
    const limiter = createRateLimiter({ rpm: 5, name: "test" });

    for (let i = 0; i < 5; i++) limiter.tryAcquire();
    expect(limiter.tryAcquire()).toBe(false);

    limiter.reset();
    expect(limiter.tryAcquire()).toBe(true);
  });

  test("tokens refill over time", async () => {
    // 600 RPM = 10 tokens per second
    const limiter = createRateLimiter({ rpm: 600, name: "test" });

    // Drain all tokens
    for (let i = 0; i < 600; i++) limiter.tryAcquire();
    expect(limiter.tryAcquire()).toBe(false);

    // Wait 200ms — should get ~2 tokens back (600 RPM = 10/s = 2/200ms)
    await new Promise((r) => setTimeout(r, 200));
    const available = limiter.availableTokens();
    expect(available).toBeGreaterThanOrEqual(1);
    expect(available).toBeLessThanOrEqual(4); // Allow tolerance
  });

  test("acquire waits until token available", async () => {
    // 6000 RPM = 100 tokens/sec, so 1 token refills in ~10ms
    const limiter = createRateLimiter({ rpm: 6000, name: "test" });

    // Drain all tokens
    for (let i = 0; i < 6000; i++) limiter.tryAcquire();

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    // Should have waited roughly 10ms (allow generous tolerance)
    expect(elapsed).toBeGreaterThanOrEqual(5);
    expect(elapsed).toBeLessThan(200);
  });

  test("acquire respects abort signal", async () => {
    const limiter = createRateLimiter({ rpm: 1, name: "test" });
    limiter.tryAcquire(); // drain the only token

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const promise = limiter.acquire(controller.signal);
    await expect(promise).rejects.toThrow("aborted");
  });

  test("acquire with already-aborted signal rejects immediately", async () => {
    const limiter = createRateLimiter({ rpm: 1, name: "test" });
    limiter.tryAcquire();

    const controller = new AbortController();
    controller.abort();

    await expect(limiter.acquire(controller.signal)).rejects.toThrow("aborted");
  });

  test("multiple waiters served FIFO", async () => {
    // 6000 RPM = 100 tokens/sec
    const limiter = createRateLimiter({ rpm: 6000, name: "test" });

    // Drain all
    for (let i = 0; i < 6000; i++) limiter.tryAcquire();

    const order: number[] = [];
    const p1 = limiter.acquire().then(() => order.push(1));
    const p2 = limiter.acquire().then(() => order.push(2));
    const p3 = limiter.acquire().then(() => order.push(3));

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });
});

// ─── getRateLimiter (registry) ───────────────────────────────

describe("getRateLimiter", () => {
  test("returns same instance for same provider", () => {
    const a = getRateLimiter("openai");
    const b = getRateLimiter("openai");
    expect(a).toBe(b);
  });

  test("uses known default RPM", () => {
    const limiter = getRateLimiter("anthropic");
    // Anthropic default = 50 RPM, so 50 tryAcquires should work
    for (let i = 0; i < 50; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }
    expect(limiter.tryAcquire()).toBe(false);
  });

  test("custom RPM overrides default", () => {
    const limiter = getRateLimiter("openai", 3);
    for (let i = 0; i < 3; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }
    expect(limiter.tryAcquire()).toBe(false);
  });

  test("unknown provider gets 200 RPM default", () => {
    const limiter = getRateLimiter("some-custom-provider");
    for (let i = 0; i < 200; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }
    expect(limiter.tryAcquire()).toBe(false);
  });

  test("clearRateLimiters resets registry", () => {
    const a = getRateLimiter("openai");
    clearRateLimiters();
    const b = getRateLimiter("openai");
    expect(a).not.toBe(b);
  });

  test("PROVIDER_DEFAULT_RPM has all major providers", () => {
    const expected = [
      "openai",
      "anthropic",
      "google",
      "mistral",
      "groq",
      "together",
      "fireworks",
      "openrouter",
      "ollama",
    ];
    for (const name of expected) {
      expect(PROVIDER_DEFAULT_RPM[name]).toBeGreaterThan(0);
    }
  });
});
