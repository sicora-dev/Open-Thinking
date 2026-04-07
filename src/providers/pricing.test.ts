import { describe, expect, test } from "bun:test";
import { estimateCost, formatCost, getModelPrice, isLocalProvider } from "./pricing";

describe("pricing", () => {
  test("known model returns price", () => {
    expect(getModelPrice("gpt-4o")).toEqual({ input: 2.5, output: 10 });
  });

  test("unknown model returns null (no invented fallback)", () => {
    expect(getModelPrice("not-a-real-model")).toBeNull();
    expect(estimateCost({ promptTokens: 1000, completionTokens: 500, totalTokens: 1500 }, "nope")).toBeNull();
  });

  test("estimateCost computes correctly", () => {
    // gpt-4o: $2.5/1M in, $10/1M out
    const cost = estimateCost(
      { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 },
      "gpt-4o",
    );
    expect(cost).toBeCloseTo(12.5, 5);
  });

  test("local provider returns zero cost regardless of model", () => {
    const cost = estimateCost(
      { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 },
      "anything-goes",
      true,
    );
    expect(cost).toBe(0);
  });

  test("formatCost edge cases", () => {
    expect(formatCost(null)).toBe("$—");
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.00001)).toBe("<$0.0001");
    expect(formatCost(0.1234)).toBe("$0.1234");
    expect(formatCost(12.345)).toBe("$12.35");
  });

  test("isLocalProvider", () => {
    expect(isLocalProvider("ollama")).toBe(true);
    expect(isLocalProvider("openai-compatible")).toBe(false);
  });
});
