import { describe, expect, test } from "bun:test";
import type { StageContextPermissions } from "../../shared/types";
import {
  checkReadAccess,
  checkWriteAccess,
  createCostTracker,
  createPolicyEngine,
  createRateLimiter,
  filterReadableKeys,
  matchGlob,
} from "./policy-engine";

describe("matchGlob", () => {
  test("exact match", () => {
    expect(matchGlob("plan.architecture", "plan.architecture")).toBe(true);
    expect(matchGlob("plan.architecture", "plan.tech")).toBe(false);
  });

  test("single wildcard *", () => {
    expect(matchGlob("plan.*", "plan.architecture")).toBe(true);
    expect(matchGlob("plan.*", "plan.tech")).toBe(true);
    expect(matchGlob("plan.*", "code.main")).toBe(false);
    expect(matchGlob("*.files", "code.files")).toBe(true);
  });

  test("* does not match multiple segments", () => {
    expect(matchGlob("plan.*", "plan.arch.detail")).toBe(false);
  });

  test("double wildcard **", () => {
    expect(matchGlob("plan.**", "plan.architecture")).toBe(true);
    expect(matchGlob("plan.**", "plan.arch.detail")).toBe(true);
    expect(matchGlob("plan.**", "plan.arch.detail.sub")).toBe(true);
    expect(matchGlob("**", "anything.at.all")).toBe(true);
  });

  test("** at start", () => {
    expect(matchGlob("**.files", "code.files")).toBe(true);
    expect(matchGlob("**.files", "a.b.c.files")).toBe(true);
  });

  test("mixed patterns", () => {
    expect(matchGlob("plan.*.summary", "plan.arch.summary")).toBe(true);
    expect(matchGlob("plan.*.summary", "plan.arch.detail")).toBe(false);
  });
});

describe("checkReadAccess", () => {
  const perms: StageContextPermissions = {
    read: ["plan.*", "code.files"],
    write: ["code.*"],
  };

  test("allows matching reads", () => {
    expect(checkReadAccess("coder", perms, "plan.architecture").ok).toBe(true);
    expect(checkReadAccess("coder", perms, "code.files").ok).toBe(true);
  });

  test("denies non-matching reads", () => {
    const result = checkReadAccess("coder", perms, "test.results");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("READ_DENIED");
      expect(result.error.stageName).toBe("coder");
    }
  });
});

describe("checkWriteAccess", () => {
  const perms: StageContextPermissions = {
    read: ["plan.*"],
    write: ["code.*"],
  };

  test("allows matching writes", () => {
    expect(checkWriteAccess("coder", perms, "code.main").ok).toBe(true);
  });

  test("denies writing outside allowed patterns", () => {
    const result = checkWriteAccess("coder", perms, "plan.override");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WRITE_DENIED");
  });
});

describe("filterReadableKeys", () => {
  test("filters keys by read permissions", () => {
    const perms: StageContextPermissions = {
      read: ["plan.*"],
      write: [],
    };
    const keys = ["plan.arch", "plan.tech", "code.main", "test.results"];
    expect(filterReadableKeys(perms, keys)).toEqual(["plan.arch", "plan.tech"]);
  });
});

describe("RateLimiter", () => {
  test("allows requests within limit", () => {
    const result = createRateLimiter("3/second");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const limiter = result.value;
    expect(limiter.tryConsume("stage1").ok).toBe(true);
    expect(limiter.tryConsume("stage1").ok).toBe(true);
    expect(limiter.tryConsume("stage1").ok).toBe(true);
  });

  test("rejects when limit exceeded", () => {
    const result = createRateLimiter("2/minute");
    if (!result.ok) return;

    const limiter = result.value;
    limiter.tryConsume("s1");
    limiter.tryConsume("s1");
    const third = limiter.tryConsume("s1");
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe("RATE_EXCEEDED");
  });

  test("rejects invalid format", () => {
    expect(createRateLimiter("abc").ok).toBe(false);
    expect(createRateLimiter("10/week").ok).toBe(false);
  });

  test("reset restores tokens", () => {
    const result = createRateLimiter("1/hour");
    if (!result.ok) return;

    const limiter = result.value;
    limiter.tryConsume("s1");
    expect(limiter.tryConsume("s1").ok).toBe(false);

    limiter.reset();
    expect(limiter.tryConsume("s1").ok).toBe(true);
  });
});

describe("CostTracker", () => {
  test("tracks cost within limit", () => {
    const result = createCostTracker("$10/run");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tracker = result.value;
    expect(tracker.record(3.5, "s1").ok).toBe(true);
    expect(tracker.record(5.0, "s2").ok).toBe(true);
    expect(tracker.total()).toBeCloseTo(8.5);
  });

  test("rejects when limit exceeded", () => {
    const result = createCostTracker("$1/run");
    if (!result.ok) return;

    const tracker = result.value;
    tracker.record(0.8, "s1");
    const over = tracker.record(0.5, "s2");
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe("COST_EXCEEDED");
  });

  test("rejects invalid format", () => {
    expect(createCostTracker("free").ok).toBe(false);
  });

  test("reset clears total", () => {
    const result = createCostTracker("$5/run");
    if (!result.ok) return;

    const tracker = result.value;
    tracker.record(4.0, "s1");
    tracker.reset();
    expect(tracker.total()).toBe(0);
  });
});

describe("PolicyEngine", () => {
  test("creates with no policies", () => {
    const result = createPolicyEngine({});
    expect(result.ok).toBe(true);
  });

  test("creates with rate limit and cost limit", () => {
    const result = createPolicyEngine({
      rate_limit: "100/hour",
      cost_limit: "$50/run",
      audit_log: true,
    });
    expect(result.ok).toBe(true);
  });

  test("rejects invalid rate limit", () => {
    const result = createPolicyEngine({ rate_limit: "bad" });
    expect(result.ok).toBe(false);
  });

  test("rate limiting works through engine", () => {
    const result = createPolicyEngine({ rate_limit: "2/minute" });
    if (!result.ok) return;

    const engine = result.value;
    expect(engine.tryConsumeRate("s1").ok).toBe(true);
    expect(engine.tryConsumeRate("s1").ok).toBe(true);
    expect(engine.tryConsumeRate("s1").ok).toBe(false);
  });

  test("cost tracking works through engine", () => {
    const result = createPolicyEngine({ cost_limit: "$1/run" });
    if (!result.ok) return;

    const engine = result.value;
    expect(engine.recordCost(0.5, "s1").ok).toBe(true);
    expect(engine.recordCost(0.6, "s2").ok).toBe(false);
    expect(engine.totalCost()).toBeCloseTo(0.5);
  });

  test("no rate limit means always allowed", () => {
    const result = createPolicyEngine({});
    if (!result.ok) return;

    for (let i = 0; i < 100; i++) {
      expect(result.value.tryConsumeRate("s1").ok).toBe(true);
    }
  });
});
