/**
 * Core type definitions for OpenThinking.
 * All types used across modules are defined here.
 */

// ─── Pipeline Config ─────────────────────────────────────────

export type PipelineMode = "sequential" | "orchestrated";

export type PermissionModeSetting = "auto" | "sandbox" | "confirm" | "strict";

export type PipelineConfig = {
  name: string;
  version: string;
  /** Execution mode. "sequential" = static DAG, "orchestrated" = LLM-driven routing. Default: "sequential". */
  mode: PipelineMode;
  /** Default permission mode for all stages. Can be overridden per-stage. Default: "confirm". */
  permissions?: PermissionModeSetting;
  context: ContextConfig;
  /** Resolved providers keyed by provider ID (e.g., "openai", "anthropic"). */
  providers: Record<string, ResolvedProvider>;
  stages: Record<string, StageDefinition>;
  policies: PoliciesConfig;
};

export type ContextConfig = {
  backend: "sqlite" | "postgres";
  vector: "embedded" | "qdrant" | "pgvector";
  ttl: string; // e.g., "7d", "24h"
};

/**
 * Resolved provider configuration (internal, after parsing).
 * Users don't write these fields in YAML — they're inferred from the provider
 * catalog and global config (~/.openthk/providers.json).
 *
 * In the pipeline YAML, providers are declared as a simple list:
 *   providers:
 *     - openai
 *     - anthropic
 *     - ollama
 *
 * Or with overrides for custom providers:
 *   providers:
 *     - id: my-custom
 *       base_url: https://custom.api.com/v1
 *       api_key: ${MY_KEY}
 */
export type ResolvedProvider = {
  type: "openai-compatible" | "ollama" | "custom";
  base_url: string;
  api_key?: string;
  headers?: Record<string, string>;
  /** Requests per minute limit. Overrides the built-in default for this provider. */
  rate_limit_rpm?: number;
};

export type StageDefinition = {
  provider: string;
  model: string;
  skill: string;
  /** Optional extra system instruction appended after the skill prompt. */
  system_message?: string;
  context: StageContextPermissions;
  depends_on?: string[];
  max_tokens?: number;
  /** Used by newer models (e.g. o1/o3-series) instead of max_tokens */
  max_completion_tokens?: number;
  temperature?: number;
  /** Max agent loop iterations (tool call rounds). Default: 50. */
  max_iterations?: number;
  /**
   * Restrict which tools the stage can use.
   * If omitted, all tools are available.
   * Example: ["read_file", "list_files", "search_files"] for read-only stages.
   */
  allowed_tools?: string[];
  /** Timeout in seconds for each LLM request in this stage. Default: 120. */
  timeout?: number;
  /** Stage role. "orchestrator" marks this stage as the orchestrator in orchestrated mode. */
  role?: "orchestrator";
  /** Alternative models to try when the primary model is rate-limited after exhausting retries. */
  fallback_models?: string[];
  on_fail?: FailureConfig;
  /** Override permission mode for this stage. Inherits from pipeline if omitted. */
  permissions?: PermissionModeSetting;
};

export type StageContextPermissions = {
  read: string[]; // Glob patterns: ["plan.*", "code.files"]
  write: string[]; // Glob patterns: ["code.*"]
  /**
   * If true, the entire readable context is inlined into the prompt
   * eagerly on every call. Default (false) is *lazy*: the LLM gets an
   * index (key + size) and must call `get_context(key)` to fetch values.
   * Small entries (<EAGER_INLINE_THRESHOLD bytes) are always inlined.
   */
  eager?: boolean;
};

export type FailureConfig = {
  retry_stage: string;
  max_retries: number;
  inject_context?: string;
};

export type PoliciesConfig = {
  global: GlobalPolicies;
};

export type GlobalPolicies = {
  rate_limit?: string; // e.g., "100/hour"
  audit_log?: boolean;
  cost_limit?: string; // e.g., "$50/run"
};

// ─── Provider / LLM ─────────────────────────────────────────

export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatRequest = {
  model: string;
  messages: Message[];
  maxTokens?: number;
  maxCompletionTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  /** Tool choice hint for OpenAI-compatible providers. */
  toolChoice?: "auto" | "required" | "none";
  stream?: boolean;
  /** Abort signal for cancellation support. */
  signal?: AbortSignal;
  /** Override the provider's default timeout (in milliseconds). */
  timeoutMs?: number;
};

export type ChatResponse = {
  id: string;
  model: string;
  content: string;
  usage: TokenUsage;
  toolCalls?: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
};

export type StreamChunk = {
  type: "content" | "tool_call" | "done" | "error";
  delta?: string;
  toolCall?: ToolCall;
  usage?: TokenUsage;
  error?: string;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/**
 * Per-stage breakdown of where tokens / bytes were spent.
 *
 * Used by the live token meter and the `/tokens` inspector to attribute
 * cost to specific tools and to the context payload, so users can see
 * which part of their pipeline is expensive.
 *
 * `toolResultBytes` is keyed by tool name and counts the *raw bytes*
 * of the tool result that was sent back to the LLM (after truncation).
 * It is a strong proxy for token cost without the overhead of running
 * a tokenizer for every tool call.
 */
export type TokenBreakdown = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Bytes of tool result content fed back to the LLM, by tool name. */
  toolResultBytes: Record<string, number>;
  /** Bytes of context block (from context store) fed to the LLM. */
  contextBytes: number;
  /** Bytes of persistent context (project soul, learned, etc.). */
  persistentContextBytes: number;
};

export function emptyBreakdown(): TokenBreakdown {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    toolResultBytes: {},
    contextBytes: 0,
    persistentContextBytes: 0,
  };
}

export type ModelInfo = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
};

// ─── Provider Interface ──────────────────────────────────────

export type LLMProvider = {
  name: string;
  chat(request: ChatRequest): Promise<import("./result").Result<ChatResponse>>;
  stream(request: ChatRequest): AsyncGenerator<StreamChunk>;
  listModels(): Promise<import("./result").Result<ModelInfo[]>>;
  healthCheck(): Promise<import("./result").Result<boolean>>;
};

// ─── Context Store ───────────────────────────────────────────

export type ContextEntry = {
  key: string;
  value: string;
  createdBy: string; // Stage name that wrote this
  createdAt: Date;
  expiresAt?: Date;
};

export type ContextStore = {
  get(key: string): Promise<import("./result").Result<ContextEntry | null>>;
  set(key: string, value: string, createdBy: string): Promise<import("./result").Result<void>>;
  delete(key: string): Promise<import("./result").Result<void>>;
  list(prefix?: string): Promise<import("./result").Result<ContextEntry[]>>;
  clear(): Promise<import("./result").Result<void>>;
};

// ─── Skills ──────────────────────────────────────────────────

export type SkillManifest = {
  name: string;
  version: string;
  description: string;
  author?: string;
  context: {
    reads: string[];
    writes: string[];
  };
  /**
   * Tools this skill can use. Defines the skill's default permissions.
   * Pipeline YAML `allowed_tools` overrides this if specified.
   * If omitted, the stage has access to all tools.
   */
  allowed_tools?: string[];
  tools?: ToolDefinition[];
  constraints?: {
    min_tokens?: number;
    recommended_models?: string[];
  };
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolFunction = ToolDefinition & {
  execute: (args: Record<string, unknown>) => Promise<import("./result").Result<unknown>>;
};

// ─── Stage Execution ─────────────────────────────────────────

export type StageStatus = "pending" | "running" | "success" | "failed" | "skipped" | "cancelled";

export type StageResult = {
  stageName: string;
  status: StageStatus;
  output?: string;
  usage?: TokenUsage;
  cost?: number;
  /** Where tokens were spent within this stage. Optional for backwards compat. */
  breakdown?: TokenBreakdown;
  durationMs: number;
  error?: string;
  contextKeysWritten: string[];
  /** Why the agent loop stopped (if applicable). */
  stopReason?: "done" | "cancelled" | "max_iterations" | "token_limit" | "error";
  /** Files written and commands run during the stage. */
  workSummary?: { filesWritten: string[]; commandsRun: string[] };
};

export type PipelineRunResult = {
  pipelineName: string;
  runId: string;
  status: "success" | "failed" | "partial";
  stages: StageResult[];
  totalDurationMs: number;
  totalCost: number;
  totalTokens: TokenUsage;
};

// ─── Events ──────────────────────────────────────────────────

export type PipelineEvent =
  | { type: "pipeline:start"; pipelineName: string; runId: string }
  | { type: "pipeline:complete"; result: PipelineRunResult }
  | { type: "stage:start"; stageName: string; model: string }
  | { type: "stage:progress"; stageName: string; chunk: StreamChunk }
  | { type: "stage:complete"; result: StageResult }
  | { type: "stage:error"; stageName: string; error: string }
  | { type: "stage:warning"; stageName: string; message: string }
  | { type: "context:read"; stageName: string; key: string }
  | { type: "context:write"; stageName: string; key: string }
  | { type: "policy:violation"; stageName: string; rule: string; detail: string }
  | { type: "tool:call"; stageName: string; toolName: string; args: Record<string, unknown> }
  | {
      type: "tool:result";
      stageName: string;
      toolName: string;
      durationMs: number;
      success: boolean;
    }
  | { type: "stage:model-fallback"; stageName: string; fromModel: string; toModel: string }
  | { type: "delegate:start"; agentName: string; task: string; model: string }
  | { type: "delegate:complete"; agentName: string; result: StageResult; durationMs: number }
  | { type: "delegate:error"; agentName: string; error: string }
  /**
   * Live token meter update. Emitted after every LLM call inside the agent loop.
   * The UI uses this to refresh the persistent status line.
   */
  | {
      type: "tokens:update";
      stageName: string;
      model: string;
      providerType: string;
      iteration: number;
      usage: TokenUsage;
      breakdown: TokenBreakdown;
    }
  /** Emitted when an agent enters a "thinking" wait — UI may show a spinner with funny text. */
  | { type: "thinking:start"; stageName: string }
  /** Emitted when the wait ends (response received, tool call, or error). */
  | { type: "thinking:end"; stageName: string }
  // ─── Permission events ──────────────────────────────────
  /** A tool action requires human confirmation before executing. */
  | {
      type: "permission:request";
      request: {
        id: string;
        tool: string;
        args: Record<string, unknown>;
        risk: "safe" | "moderate" | "dangerous";
        description: string;
        subject: string;
      };
      stageName: string;
    }
  /** A permission request was granted. */
  | { type: "permission:granted"; requestId: string; stageName: string; remembered: boolean }
  /** A permission request was denied. */
  | { type: "permission:denied"; requestId: string; stageName: string; remembered: boolean }
  /** A tool action was auto-allowed (safe action or auto mode). */
  | { type: "permission:auto-allowed"; tool: string; subject: string; stageName: string };
