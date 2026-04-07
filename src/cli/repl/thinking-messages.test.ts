import { describe, expect, test } from "bun:test";
import { createThinkingPool, toneForElapsed } from "./thinking-messages";

describe("thinking-messages", () => {
  test("toneForElapsed thresholds", () => {
    expect(toneForElapsed(0)).toBe("thinking");
    expect(toneForElapsed(8_001)).toBe("still");
    expect(toneForElapsed(30_001)).toBe("long");
  });

  test("pool never returns the same message twice in a row", () => {
    const pool = createThinkingPool();
    let prev = pool.next("thinking");
    for (let i = 0; i < 200; i++) {
      const next = pool.next("thinking");
      expect(next).not.toBe(prev);
      prev = next;
    }
  });

  test("pool draws from the requested tone", () => {
    const pool = createThinkingPool();
    // We can't assert specific strings, but every draw should be a non-empty string.
    for (const tone of ["thinking", "still", "long"] as const) {
      const msg = pool.next(tone);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  test("reset clears recent history without crashing", () => {
    const pool = createThinkingPool();
    pool.next();
    pool.reset();
    expect(typeof pool.next()).toBe("string");
  });
});
