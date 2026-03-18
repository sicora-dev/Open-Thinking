/**
 * Policy engine: enforces read/write access control per stage,
 * rate limiting (token bucket), and cost tracking.
 */
import { PolicyError } from "../../shared/errors";
import { type Result, err, ok } from "../../shared/result";
import type { GlobalPolicies, StageContextPermissions } from "../../shared/types";

// ─── Glob matching ──────────────────────────────────────────

/**
 * Match a context key against a glob pattern.
 * Supports `*` (single segment) and `**` (any depth).
 * Segments are separated by `.`.
 */
export function matchGlob(pattern: string, key: string): boolean {
  const patternParts = pattern.split(".");
  const keyParts = key.split(".");
  return globMatch(patternParts, 0, keyParts, 0);
}

function globMatch(pp: string[], piStart: number, kp: string[], kiStart: number): boolean {
  let pi = piStart;
  let ki = kiStart;
  while (pi < pp.length && ki < kp.length) {
    const seg = pp[pi];
    if (seg === "**") {
      // ** matches zero or more segments
      for (let skip = ki; skip <= kp.length; skip++) {
        if (globMatch(pp, pi + 1, kp, skip)) return true;
      }
      return false;
    }
    if (seg === "*") {
      // * matches exactly one segment
      pi++;
      ki++;
      continue;
    }
    if (seg !== kp[ki]) return false;
    pi++;
    ki++;
  }
  // Trailing ** can match zero
  while (pi < pp.length && pp[pi] === "**") pi++;
  return pi === pp.length && ki === kp.length;
}

// ─── Access control ─────────────────────────────────────────

export function checkReadAccess(
  stageName: string,
  permissions: StageContextPermissions,
  key: string,
): Result<void> {
  for (const pattern of permissions.read) {
    if (matchGlob(pattern, key)) return ok(undefined);
  }
  return err(
    new PolicyError(
      `Stage "${stageName}" is not allowed to read key "${key}"`,
      "READ_DENIED",
      stageName,
      `Allowed read patterns: [${permissions.read.join(", ")}]`,
    ),
  );
}

export function checkWriteAccess(
  stageName: string,
  permissions: StageContextPermissions,
  key: string,
): Result<void> {
  for (const pattern of permissions.write) {
    if (matchGlob(pattern, key)) return ok(undefined);
  }
  return err(
    new PolicyError(
      `Stage "${stageName}" is not allowed to write key "${key}"`,
      "WRITE_DENIED",
      stageName,
      `Allowed write patterns: [${permissions.write.join(", ")}]`,
    ),
  );
}

/**
 * Filter a list of context keys to only those readable by the stage.
 */
export function filterReadableKeys(permissions: StageContextPermissions, keys: string[]): string[] {
  return keys.filter((key) => permissions.read.some((pattern) => matchGlob(pattern, key)));
}

// ─── Rate limiter (token bucket) ────────────────────────────

export type RateLimiter = {
  /** Try to consume one token. Returns ok if allowed, err if rate exceeded. */
  tryConsume(stageName: string): Result<void>;
  /** Reset the limiter. */
  reset(): void;
};

/**
 * Parse a rate limit string like "100/hour", "10/minute", "1000/day".
 */
function parseRateLimit(limit: string): { tokens: number; windowMs: number } | null {
  const match = limit.match(/^(\d+)\/(second|minute|hour|day)$/);
  if (!match?.[1] || !match[2]) return null;
  const tokens = Number.parseInt(match[1], 10);
  const unit = match[2] as "second" | "minute" | "hour" | "day";
  const windowMs = {
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
  }[unit];
  return { tokens, windowMs };
}

export function createRateLimiter(limitStr: string): Result<RateLimiter> {
  const parsed = parseRateLimit(limitStr);
  if (!parsed) {
    return err(
      new PolicyError(
        `Invalid rate limit format: "${limitStr}". Expected "N/second|minute|hour|day"`,
        "RATE_EXCEEDED",
      ),
    );
  }

  let { tokens } = parsed;
  const { windowMs } = parsed;
  const maxTokens = parsed.tokens;
  let lastRefill = Date.now();

  function refill() {
    const now = Date.now();
    const elapsed = now - lastRefill;
    const refillAmount = Math.floor((elapsed / windowMs) * maxTokens);
    if (refillAmount > 0) {
      tokens = Math.min(maxTokens, tokens + refillAmount);
      lastRefill = now;
    }
  }

  function tryConsume(stageName: string): Result<void> {
    refill();
    if (tokens > 0) {
      tokens--;
      return ok(undefined);
    }
    return err(
      new PolicyError(
        `Rate limit exceeded for stage "${stageName}": ${limitStr}`,
        "RATE_EXCEEDED",
        stageName,
      ),
    );
  }

  function reset() {
    tokens = maxTokens;
    lastRefill = Date.now();
  }

  return ok({ tryConsume, reset });
}

// ─── Cost tracker ───────────────────────────────────────────

export type CostTracker = {
  /** Record a cost. Returns err if the limit would be exceeded. */
  record(amount: number, stageName: string): Result<void>;
  /** Get total cost so far. */
  total(): number;
  /** Reset the tracker. */
  reset(): void;
};

function parseCostLimit(limit: string): number | null {
  const match = limit.match(/^\$?([\d.]+)\/(run|hour|day)$/);
  if (!match?.[1]) return null;
  return Number.parseFloat(match[1]);
}

export function createCostTracker(limitStr: string): Result<CostTracker> {
  const maxCostParsed = parseCostLimit(limitStr);
  if (maxCostParsed === null || Number.isNaN(maxCostParsed)) {
    return err(
      new PolicyError(
        `Invalid cost limit format: "${limitStr}". Expected "$N/run|hour|day"`,
        "COST_EXCEEDED",
      ),
    );
  }

  const maxCost = maxCostParsed;
  let totalCost = 0;

  function record(amount: number, stageName: string): Result<void> {
    if (totalCost + amount > maxCost) {
      return err(
        new PolicyError(
          `Cost limit exceeded: $${(totalCost + amount).toFixed(4)} > $${maxCost} for stage "${stageName}"`,
          "COST_EXCEEDED",
          stageName,
          `Current total: $${totalCost.toFixed(4)}, attempted: $${amount.toFixed(4)}`,
        ),
      );
    }
    totalCost += amount;
    return ok(undefined);
  }

  function total(): number {
    return totalCost;
  }

  function reset() {
    totalCost = 0;
  }

  return ok({ record, total, reset });
}

// ─── Policy engine (orchestrates all policies) ──────────────

export type PolicyEngine = {
  checkRead(stageName: string, permissions: StageContextPermissions, key: string): Result<void>;
  checkWrite(stageName: string, permissions: StageContextPermissions, key: string): Result<void>;
  filterReadable(permissions: StageContextPermissions, keys: string[]): string[];
  tryConsumeRate(stageName: string): Result<void>;
  recordCost(amount: number, stageName: string): Result<void>;
  totalCost(): number;
  reset(): void;
};

export function createPolicyEngine(policies: GlobalPolicies): Result<PolicyEngine> {
  let rateLimiter: RateLimiter | null = null;
  let costTracker: CostTracker | null = null;

  if (policies.rate_limit) {
    const rlResult = createRateLimiter(policies.rate_limit);
    if (!rlResult.ok) return rlResult;
    rateLimiter = rlResult.value;
  }

  if (policies.cost_limit) {
    const ctResult = createCostTracker(policies.cost_limit);
    if (!ctResult.ok) return ctResult;
    costTracker = ctResult.value;
  }

  return ok({
    checkRead: checkReadAccess,
    checkWrite: checkWriteAccess,
    filterReadable: filterReadableKeys,

    tryConsumeRate(stageName: string): Result<void> {
      if (!rateLimiter) return ok(undefined);
      return rateLimiter.tryConsume(stageName);
    },

    recordCost(amount: number, stageName: string): Result<void> {
      if (!costTracker) return ok(undefined);
      return costTracker.record(amount, stageName);
    },

    totalCost(): number {
      return costTracker?.total() ?? 0;
    },

    reset() {
      rateLimiter?.reset();
      costTracker?.reset();
    },
  });
}
