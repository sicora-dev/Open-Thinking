/**
 * Core type definitions for OpenMind.
 * All types used across modules are defined here.
 */

// ─── Pipeline Config ─────────────────────────────────────────

export type PipelineMode = "sequential" | "orchestrated";

export type PipelineConfig = {
  name: string;
  version: string;
  /** Execution mode. "sequential" = static DAG, "orchestrated" = LLM-driven routing. Default: "sequential". */
  mode: PipelineMode;
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
 * catalog and global config (~/.openmind/providers.json).
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
  context: StageContextPermissions;
  depends_on?: string[];
  max_tokens?: number;
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
};

export type StageContextPermissions = {
  read: string[]; // Glob patterns: ["plan.*", "code.files"]
  write: string[]; // Glob patterns: ["code.*"]
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
  temperature?: number;
  systemPrompt?: string;
  tools?: ToolDefinition[];
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
  | { type: "delegate:error"; agentName: string; error: string };
