/** Custom error types for OpenMind. Each module has its own error type. */

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly code: "PARSE_ERROR" | "VALIDATION_ERROR" | "EXECUTION_ERROR",
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: "AUTH_ERROR" | "RATE_LIMIT" | "TIMEOUT" | "API_ERROR" | "NOT_FOUND",
    public readonly statusCode?: number,
    public readonly provider?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class ContextError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "WRITE_ERROR" | "READ_ERROR" | "EXPIRED",
    public readonly key?: string,
  ) {
    super(message);
    this.name = "ContextError";
  }
}

export class PolicyError extends Error {
  constructor(
    message: string,
    public readonly code: "READ_DENIED" | "WRITE_DENIED" | "RATE_EXCEEDED" | "COST_EXCEEDED",
    public readonly stageName?: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "PolicyError";
  }
}
