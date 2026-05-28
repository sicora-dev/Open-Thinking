import type { RunRow } from "./api";

export type RunEvent = {
  seq: number;
  ts: string;
  type: string;
  payload: unknown;
};

export type StageProjection = {
  id: string;
  name: string;
  status: "pending" | "running" | "success" | "failed" | "cancelled" | "skipped";
  model: string | null;
  provider: string | null;
  durationMs: number | null;
  tokens: number | null;
  cost: number | null;
  iteration: number | null;
  keysRead: string[];
  keysWritten: string[];
  tools: string[];
  logs: string[];
};

export type ProjectedLogLine = {
  runId: string;
  pipelineName: string;
  ts: string;
  level: "info" | "tool" | "ok" | "warn" | "err" | "ctx" | "model";
  source: string;
  message: string;
  type: string;
};

export type ContextActivity = {
  runId: string;
  pipelineName: string;
  ts: string;
  action: "read" | "write";
  key: string;
  stageName: string | null;
};

export type RunProjection = {
  stages: StageProjection[];
  totalTokens: number;
  totalCost: number;
  eventLogs: ProjectedLogLine[];
  contextActivities: ContextActivity[];
  activeStageId: string | null;
};

type Payload = Record<string, unknown> & {
  stageName?: string;
  agentName?: string;
  model?: string;
  providerType?: string;
  key?: string;
  toolName?: string;
  success?: boolean;
  durationMs?: number;
  iteration?: number;
  message?: string;
  error?: string;
  rule?: string;
  detail?: string;
  remembered?: boolean;
  requestId?: string;
  request?: {
    id?: string;
    tool?: string;
    risk?: "safe" | "moderate" | "dangerous";
    description?: string;
    subject?: string;
  };
  result?: Record<string, unknown> & {
    stageName?: string;
    status?: StageProjection["status"];
    durationMs?: number;
    cost?: number;
    contextKeysWritten?: string[];
    usage?: {
      totalTokens?: number;
    };
    workSummary?: {
      filesWritten?: string[];
      commandsRun?: string[];
    };
  };
  usage?: {
    totalTokens?: number;
  };
};

const EVENT_LEVEL: Record<string, ProjectedLogLine["level"]> = {
  "stage:start": "info",
  "stage:progress": "info",
  "stage:complete": "ok",
  "stage:error": "err",
  "stage:warning": "warn",
  "context:read": "ctx",
  "context:write": "ctx",
  "policy:violation": "warn",
  "tool:call": "tool",
  "tool:result": "tool",
  "delegate:start": "model",
  "delegate:complete": "ok",
  "delegate:error": "err",
  "tokens:update": "model",
  "thinking:start": "model",
  "thinking:end": "model",
  "permission:request": "warn",
  "permission:granted": "ok",
  "permission:denied": "err",
  "permission:auto-allowed": "ok",
  "pipeline:start": "info",
  "pipeline:complete": "ok",
  "run:done": "ok",
  "run:error": "err",
};

export const RUN_EVENT_TYPES = [
  "pipeline:start",
  "pipeline:complete",
  "stage:start",
  "stage:progress",
  "stage:complete",
  "stage:error",
  "stage:warning",
  "context:read",
  "context:write",
  "policy:violation",
  "tool:call",
  "tool:result",
  "delegate:start",
  "delegate:complete",
  "delegate:error",
  "tokens:update",
  "thinking:start",
  "thinking:end",
  "permission:request",
  "permission:granted",
  "permission:denied",
  "permission:auto-allowed",
  "run:done",
  "run:error",
];

export function projectRun(run: RunRow, events: RunEvent[]): RunProjection {
  const stages = new Map<string, StageProjection>();
  const eventLogs: ProjectedLogLine[] = [];
  const contextActivities: ContextActivity[] = [];
  let totalTokens = run.totalTokens ?? 0;
  let totalCost = run.totalCost ?? 0;

  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const payload = asPayload(event.payload);
    const stageName = getStageName(event.type, payload);
    const stage = stageName ? ensureStage(stages, stageName) : null;

    if (event.type === "stage:start" && stage) {
      stage.status = "running";
      stage.model = stringOrNull(payload.model) ?? stage.model;
    }

    if (event.type === "stage:complete" && payload.result?.stageName) {
      const resultStage = ensureStage(stages, payload.result.stageName);
      resultStage.status = payload.result.status ?? "success";
      resultStage.durationMs = numberOrNull(payload.result.durationMs);
      resultStage.tokens = numberOrNull(payload.result.usage?.totalTokens);
      resultStage.cost = numberOrNull(payload.result.cost);
      resultStage.keysWritten = unique([
        ...resultStage.keysWritten,
        ...(payload.result.contextKeysWritten ?? []),
      ]);
      totalTokens = Math.max(totalTokens, resultStage.tokens ?? 0);
      totalCost = Math.max(totalCost, resultStage.cost ?? 0);
      const files = payload.result.workSummary?.filesWritten ?? [];
      const commands = payload.result.workSummary?.commandsRun ?? [];
      for (const file of files) resultStage.logs.push(`file written: ${file}`);
      for (const command of commands) resultStage.logs.push(`command run: ${command}`);
    }

    if (event.type === "stage:error" && stage) {
      stage.status = "failed";
    }

    if (event.type === "delegate:start" && stage) {
      stage.status = "running";
      stage.model = stringOrNull(payload.model) ?? stage.model;
    }

    if (event.type === "delegate:complete" && stage) {
      stage.status = "success";
      stage.durationMs = numberOrNull(payload.durationMs);
      stage.tokens = numberOrNull(payload.result?.usage?.totalTokens) ?? stage.tokens;
      stage.cost = numberOrNull(payload.result?.cost) ?? stage.cost;
    }

    if (event.type === "delegate:error" && stage) {
      stage.status = "failed";
    }

    if (event.type === "tokens:update" && stage) {
      stage.status = stage.status === "pending" ? "running" : stage.status;
      stage.model = stringOrNull(payload.model) ?? stage.model;
      stage.provider = stringOrNull(payload.providerType) ?? stage.provider;
      stage.iteration = numberOrNull(payload.iteration) ?? stage.iteration;
      stage.tokens = numberOrNull(payload.usage?.totalTokens) ?? stage.tokens;
      totalTokens = Math.max(totalTokens, stage.tokens ?? 0);
    }

    if (event.type === "context:read" && stage && payload.key) {
      stage.keysRead = unique([...stage.keysRead, payload.key]);
      contextActivities.push({
        runId: run.id,
        pipelineName: run.pipelineName,
        ts: event.ts,
        action: "read",
        key: payload.key,
        stageName,
      });
    }

    if (event.type === "context:write" && stage && payload.key) {
      stage.keysWritten = unique([...stage.keysWritten, payload.key]);
      contextActivities.push({
        runId: run.id,
        pipelineName: run.pipelineName,
        ts: event.ts,
        action: "write",
        key: payload.key,
        stageName,
      });
    }

    if ((event.type === "tool:call" || event.type === "tool:result") && stage && payload.toolName) {
      stage.tools = unique([...stage.tools, payload.toolName]);
    }

    const stageMessage = summarizeStageEvent(event.type, payload);
    if (stage && stageMessage) {
      stage.logs.push(`[${formatTime(event.ts)}] ${stageMessage}`);
    }

    eventLogs.push({
      runId: run.id,
      pipelineName: run.pipelineName,
      ts: event.ts,
      level: EVENT_LEVEL[event.type] ?? "info",
      source: stageName ?? run.pipelineName,
      message: summarizeEvent(event.type, payload),
      type: event.type,
    });
  }

  const stageList = [...stages.values()];
  const activeStage = [...stageList].reverse().find((stage) => stage.status === "running") ?? null;

  return {
    stages: stageList,
    totalTokens,
    totalCost,
    eventLogs,
    contextActivities,
    activeStageId: activeStage?.id ?? null,
  };
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return iso;
  const seconds = Math.max(0, Math.floor(diff / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const min = minutes % 60;
  return min ? `${hours}h ${min}m` : `${hours}h`;
}

export function runDuration(run: RunRow): string {
  const start = new Date(run.startedAt).getTime();
  const end = run.endedAt ? new Date(run.endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
  return formatDurationMs(Math.max(0, end - start));
}

export function formatMoney(value: number): string {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ensureStage(stages: Map<string, StageProjection>, name: string): StageProjection {
  const existing = stages.get(name);
  if (existing) return existing;
  const stage: StageProjection = {
    id: name,
    name,
    status: "pending",
    model: null,
    provider: null,
    durationMs: null,
    tokens: null,
    cost: null,
    iteration: null,
    keysRead: [],
    keysWritten: [],
    tools: [],
    logs: [],
  };
  stages.set(name, stage);
  return stage;
}

function getStageName(type: string, payload: Payload): string | null {
  if (payload.stageName) return payload.stageName;
  if (type === "stage:complete" && payload.result?.stageName) return payload.result.stageName;
  if (type.startsWith("delegate:") && payload.agentName) return payload.agentName;
  if (type.startsWith("permission:") && payload.stageName) return payload.stageName;
  return null;
}

function summarizeStageEvent(type: string, payload: Payload): string | null {
  if (type === "stage:start") return `started${payload.model ? ` on ${payload.model}` : ""}`;
  if (type === "stage:progress") return JSON.stringify(payload.chunk ?? {}).slice(0, 180);
  if (type === "stage:complete") {
    return `completed ${payload.result?.status ?? "success"}${payload.result?.durationMs ? ` in ${formatDurationMs(payload.result.durationMs)}` : ""}`;
  }
  if (type === "stage:error") return `error: ${payload.error ?? ""}`;
  if (type === "stage:warning") return `warning: ${payload.message ?? ""}`;
  if (type === "context:read") return `read ${payload.key ?? ""}`;
  if (type === "context:write") return `wrote ${payload.key ?? ""}`;
  if (type === "policy:violation") return `policy ${payload.rule ?? "violation"}: ${payload.detail ?? ""}`;
  if (type === "tool:call") return `tool call ${payload.toolName ?? ""}`;
  if (type === "tool:result") return `tool result ${payload.toolName ?? ""} ${payload.success ? "ok" : "error"}`;
  if (type === "tokens:update") return `tokens ${payload.usage?.totalTokens ?? 0}${payload.iteration != null ? ` at iteration ${payload.iteration}` : ""}`;
  if (type === "thinking:start") return "waiting for model";
  if (type === "thinking:end") return "model response received";
  if (type === "permission:request") {
    return `permission requested for ${payload.request?.tool ?? "tool"}: ${payload.request?.description ?? ""}`;
  }
  if (type === "permission:granted") {
    return `permission granted${payload.remembered ? " and remembered" : ""}`;
  }
  if (type === "permission:denied") {
    return `permission denied${payload.remembered ? " and remembered" : ""}`;
  }
  if (type === "permission:auto-allowed") return `permission auto-allowed for ${payload.tool ?? "tool"}`;
  if (type === "delegate:start") return `delegate started${payload.model ? ` on ${payload.model}` : ""}`;
  if (type === "delegate:complete") return `delegate completed${payload.durationMs ? ` in ${formatDurationMs(payload.durationMs)}` : ""}`;
  if (type === "delegate:error") return `delegate error: ${payload.error ?? ""}`;
  return null;
}

function summarizeEvent(type: string, payload: Payload): string {
  if (type === "pipeline:start") return `pipeline started`;
  if (type === "pipeline:complete") return `pipeline completed`;
  if (type === "stage:start") return `${payload.stageName ?? "stage"} started${payload.model ? ` on ${payload.model}` : ""}`;
  if (type === "stage:complete") return `${payload.result?.stageName ?? "stage"} ${payload.result?.status ?? "complete"}`;
  if (type === "stage:error") return `${payload.stageName ?? "stage"} error: ${payload.error ?? ""}`;
  if (type === "stage:warning") return `${payload.stageName ?? "stage"} warning: ${payload.message ?? ""}`;
  if (type === "context:read") return `${payload.stageName ?? "stage"} read ${payload.key ?? ""}`;
  if (type === "context:write") return `${payload.stageName ?? "stage"} wrote ${payload.key ?? ""}`;
  if (type === "policy:violation") return `${payload.stageName ?? "stage"} ${payload.rule ?? "policy"}: ${payload.detail ?? ""}`;
  if (type === "tool:call") return `${payload.stageName ?? "stage"} called ${payload.toolName ?? "tool"}`;
  if (type === "tool:result") return `${payload.stageName ?? "stage"} ${payload.toolName ?? "tool"} ${payload.success ? "ok" : "error"}`;
  if (type === "tokens:update") return `${payload.stageName ?? "stage"} ${payload.usage?.totalTokens ?? 0} tokens`;
  if (type === "thinking:start") return `${payload.stageName ?? "stage"} waiting for model`;
  if (type === "thinking:end") return `${payload.stageName ?? "stage"} model response received`;
  if (type === "permission:request") {
    return `${payload.stageName ?? "stage"} needs permission for ${payload.request?.tool ?? "tool"}: ${payload.request?.description ?? ""}`;
  }
  if (type === "permission:granted") return `${payload.stageName ?? "stage"} permission granted`;
  if (type === "permission:denied") return `${payload.stageName ?? "stage"} permission denied`;
  if (type === "permission:auto-allowed") {
    return `${payload.stageName ?? "stage"} auto-allowed ${payload.tool ?? "tool"}`;
  }
  if (type === "delegate:start") return `${payload.agentName ?? "delegate"} started`;
  if (type === "delegate:complete") return `${payload.agentName ?? "delegate"} completed`;
  if (type === "delegate:error") return `${payload.agentName ?? "delegate"} error: ${payload.error ?? ""}`;
  if (type === "run:done") return `run finished`;
  if (type === "run:error") return `run error: ${payload.error ?? ""}`;
  return JSON.stringify(payload).slice(0, 160);
}

function asPayload(payload: unknown): Payload {
  if (payload && typeof payload === "object") return payload as Payload;
  return {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
