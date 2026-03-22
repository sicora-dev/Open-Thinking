/**
 * Agent loop: iteratively calls an LLM, executes tool calls, and feeds
 * results back until the model stops requesting tools.
 *
 * Context management:
 * Instead of accumulating an ever-growing message history (which causes
 * quadratic token growth), the loop maintains **working memory** — an
 * auto-maintained action log + model notes. Before each LLM call, messages
 * are rebuilt: [task + working memory] + [last exchange only].
 * Old messages are discarded; the working memory preserves continuity.
 *
 * Safety mechanisms:
 * - **Tool output truncation**: results > 2000 lines or 50KB are truncated.
 * - **Doom loop detection**: 3 consecutive identical tool calls trigger a
 *   warning and return the cached result instead of re-executing.
 * - **Soft stop**: approaching max iterations triggers a wind-down sequence
 *   that forces the model to summarize and stop cleanly.
 */
import type { EventBus } from "../../core/events/event-bus";
import { type Result, err, ok } from "../../shared/result";
import type {
  ChatRequest,
  LLMProvider,
  Message,
  ToolDefinition,
  TokenUsage,
} from "../../shared/types";
import type { ToolRegistry } from "../../tools";

export type StopReason = "done" | "cancelled" | "max_iterations" | "token_limit" | "error";

export type AgentLoopConfig = {
  provider: LLMProvider;
  request: ChatRequest;
  toolRegistry: ToolRegistry;
  maxIterations: number;
  eventBus: EventBus;
  stageName: string;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /**
   * Called when the model hits the token limit (finishReason: "length").
   * Returns true to continue execution, false to stop.
   * If not provided, the loop stops on token limit.
   */
  onTokenLimit?: (summary: WorkSummary) => Promise<boolean>;
};

export type WorkSummary = {
  filesWritten: string[];
  commandsRun: string[];
};

export type AgentLoopResult = {
  /** The final text content from the assistant. */
  finalContent: string;
  /** Full conversation history including tool calls/results. */
  messages: Message[];
  /** Aggregated token usage across all iterations. */
  totalUsage: TokenUsage;
  /** Number of LLM calls made. */
  iterations: number;
  /** Why the loop stopped. */
  stopReason: StopReason;
  /** What the agent did during this run. */
  workSummary: WorkSummary;
};

/** Max consecutive "length" auto-continues before requiring user input. */
const MAX_LENGTH_CONTINUES = 3;

/** Max consecutive identical tool calls before triggering doom loop detection. */
const DOOM_LOOP_THRESHOLD = 3;

/** Max lines in a tool result before truncation. */
const TOOL_OUTPUT_MAX_LINES = 2000;

/** Max bytes in a tool result before truncation. */
const TOOL_OUTPUT_MAX_BYTES = 50 * 1024;

// ─── Tool output truncation ─────────────────────────────────

/**
 * Truncate tool output that exceeds size limits.
 * Keeps the first and last portions so the model has head + tail context.
 */
function truncateToolOutput(content: string): string {
  const bytes = new TextEncoder().encode(content).length;
  const lines = content.split("\n");

  if (lines.length <= TOOL_OUTPUT_MAX_LINES && bytes <= TOOL_OUTPUT_MAX_BYTES) {
    return content;
  }

  const keepHead = 200;
  const keepTail = 100;
  const head = lines.slice(0, keepHead).join("\n");
  const tail = lines.slice(-keepTail).join("\n");
  const omitted = lines.length - keepHead - keepTail;

  return `${head}\n\n[… truncated ${omitted} lines (${formatBytes(bytes)} total) — use read_file with offset/limit to see specific sections …]\n\n${tail}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ─── Doom loop detection ─────────────────────────────────────

type ToolCallSignature = { tool: string; args: string };

/**
 * Check if the last N tool calls are identical (same tool + same args).
 * Returns the cached result if a loop is detected, null otherwise.
 */
function checkDoomLoop(
  recentCalls: ToolCallSignature[],
  currentTool: string,
  currentArgs: string,
  cachedResults: Map<string, string>,
): string | null {
  if (recentCalls.length < DOOM_LOOP_THRESHOLD - 1) return null;

  const tail = recentCalls.slice(-(DOOM_LOOP_THRESHOLD - 1));
  const allMatch = tail.every((c) => c.tool === currentTool && c.args === currentArgs);

  if (!allMatch) return null;

  // Return cached result from the first call
  const cacheKey = `${currentTool}:${currentArgs}`;
  return cachedResults.get(cacheKey) ?? null;
}

// ─── Working memory ──────────────────────────────────────────

/**
 * Working memory for the agent loop. Two sections:
 * - **actionLog**: auto-maintained by the system after each tool round.
 *   One compact line per iteration so the model always knows what it did.
 * - **notes**: model-maintained via scratchpad_write. For plans, decisions,
 *   custom context the model wants to persist.
 */
type WorkingMemory = {
  actionLog: string[];
  notes: string;
};

const WORKING_MEMORY_NOTE = [
  "",
  "## Working Memory",
  "Your conversation history is trimmed automatically between iterations to save tokens.",
  "You will always see: (1) the task, (2) your working memory with a full action log, and (3) your most recent exchange.",
  "The action log is maintained automatically — you will always see what you already did.",
  "Use `scratchpad_write(content)` to save custom notes (plans, decisions, key findings) that persist across iterations.",
  "IMPORTANT: Do NOT repeat actions you can see in your action log. Move forward with your task.",
].join("\n");

const SCRATCHPAD_TOOL_DEFS: ToolDefinition[] = [
  {
    name: "scratchpad_write",
    description:
      "Save custom notes to your working memory (plans, decisions, key findings). Persists across iterations. Content REPLACES previous notes — include everything you want to keep.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The content to save. Replaces any previous notes.",
        },
      },
      required: ["content"],
    },
  },
];

/**
 * Wrap a tool registry to include the scratchpad_write tool.
 */
function withScratchpad(registry: ToolRegistry, memory: WorkingMemory): ToolRegistry {
  return {
    definitions(): ToolDefinition[] {
      return [...registry.definitions(), ...SCRATCHPAD_TOOL_DEFS];
    },
    async execute(name: string, args: Record<string, unknown>): Promise<Result<string>> {
      if (name === "scratchpad_write") {
        memory.notes = String(args.content ?? "");
        return ok("Saved to working memory.");
      }
      return registry.execute(name, args);
    },
  };
}

/**
 * Build the task message for the current iteration.
 * Includes the original task + working memory (action log + notes).
 */
function buildTaskMessage(original: Message, memory: WorkingMemory): Message {
  const hasLog = memory.actionLog.length > 0;
  const hasNotes = memory.notes.length > 0;

  if (!hasLog && !hasNotes) return original;

  const sections: string[] = [];

  if (hasLog) {
    sections.push("## Action History");
    sections.push(...memory.actionLog);
  }

  if (hasNotes) {
    sections.push("");
    sections.push("## Your Notes");
    sections.push(memory.notes);
  }

  return {
    ...original,
    content: `${original.content}\n\n--- Working Memory ---\n${sections.join("\n")}\n--- End Working Memory ---`,
  };
}

/**
 * Summarize a single tool call result into a compact string.
 */
function summarizeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  success: boolean,
  resultContent: string,
): string {
  let callSig = toolName;
  const keyArg = getKeyArg(toolName, args);
  if (keyArg) callSig = `${toolName}(${keyArg})`;

  if (!success) return `${callSig} → ERROR`;

  switch (toolName) {
    case "read_file": {
      const lines = resultContent.split("\n").length;
      return `${callSig} → ${lines} lines`;
    }
    case "write_file":
      return `${callSig} → OK`;
    case "list_files": {
      const items = resultContent.split("\n").filter((l) => l.trim()).length;
      return `${callSig} → ${items} items`;
    }
    case "run_command": {
      const firstLine = resultContent.split("\n")[0] ?? "";
      const preview = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
      return `${callSig} → ${preview}`;
    }
    case "search_files": {
      const matches = resultContent.split("\n").filter((l) => l.trim()).length;
      return `${callSig} → ${matches} matches`;
    }
    case "delegate": {
      const preview = resultContent.length > 80 ? `${resultContent.slice(0, 80)}…` : resultContent;
      return `${callSig} → ${preview}`;
    }
    case "scratchpad_write":
      return `${callSig} → saved`;
    default:
      return `${callSig} → done`;
  }
}

/** Extract the most identifying argument for a tool call. */
function getKeyArg(toolName: string, args: Record<string, unknown>): string | null {
  switch (toolName) {
    case "read_file":
    case "write_file":
    case "list_files":
      return typeof args.path === "string" ? args.path : null;
    case "run_command":
      if (typeof args.command === "string") {
        return args.command.length > 60 ? `${args.command.slice(0, 60)}…` : args.command;
      }
      return null;
    case "search_files":
      return typeof args.pattern === "string" ? `"${args.pattern}"` : null;
    case "delegate":
      return typeof args.agent === "string" ? args.agent : null;
    default:
      return null;
  }
}

// ─── Agent loop ──────────────────────────────────────────────

export async function runAgentLoop(config: AgentLoopConfig): Promise<Result<AgentLoopResult>> {
  const { provider, request, toolRegistry, maxIterations, eventBus, stageName, signal } = config;

  // Set up working memory and augmented tool registry
  const memory: WorkingMemory = { actionLog: [], notes: "" };
  const registry = withScratchpad(toolRegistry, memory);

  // Append working memory instructions to system prompt
  const systemPrompt = request.systemPrompt
    ? `${request.systemPrompt}${WORKING_MEMORY_NOTE}`
    : WORKING_MEMORY_NOTE;

  // Save the original task message (first user message)
  const originalTask = request.messages[0];
  if (!originalTask) {
    return err(new Error("Agent loop requires at least one message"));
  }

  // State
  const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const fullHistory: Message[] = [...request.messages];
  let lastExchange: Message[] = [];
  let finalContent = "";
  let iterations = 0;
  let lengthContinues = 0;
  let stopReason: StopReason = "done";
  const filesWritten: string[] = [];
  const commandsRun: string[] = [];

  // Doom loop tracking
  const recentCalls: ToolCallSignature[] = [];
  const cachedResults = new Map<string, string>();

  for (let i = 0; i < maxIterations; i++) {
    if (signal?.aborted) {
      stopReason = "cancelled";
      return err(new Error("Pipeline execution was cancelled"));
    }

    iterations++;

    // ── Soft stop: wind down near max iterations ─────────────
    const remaining = maxIterations - i;
    const isFinalIteration = remaining === 1;
    const isWindDown = remaining === 2;

    // Build messages: refreshed task + working memory + last exchange only
    const currentMessages = [buildTaskMessage(originalTask, memory), ...lastExchange];

    // On wind-down, inject a warning
    if (isWindDown) {
      const windDownMsg: Message = {
        role: "user",
        content:
          "IMPORTANT: You are approaching the maximum number of steps. " +
          "Finish your current work NOW. On the next step you will not have access to tools. " +
          "Complete any critical writes, then prepare a summary of what you accomplished and what remains.",
      };
      currentMessages.push(windDownMsg);
    }

    const chatResult = await provider.chat({
      ...request,
      systemPrompt,
      messages: currentMessages,
      // Final iteration: no tools — force a text summary
      tools: isFinalIteration ? [] : registry.definitions(),
      signal,
    });

    if (!chatResult.ok) {
      return err(chatResult.error);
    }

    const response = chatResult.value;

    // Accumulate usage
    totalUsage.promptTokens += response.usage.promptTokens;
    totalUsage.completionTokens += response.usage.completionTokens;
    totalUsage.totalTokens += response.usage.totalTokens;

    // Build assistant message and start collecting this round's exchange
    const assistantMsg: Message = {
      role: "assistant",
      content: response.content,
      tool_calls: response.toolCalls,
    };
    fullHistory.push(assistantMsg);
    const exchange: Message[] = [assistantMsg];

    if (response.content) {
      finalContent = response.content;
    }

    // ── Handle "length" — model hit token limit ──────────────
    if (response.finishReason === "length") {
      lengthContinues++;

      eventBus.emit({
        type: "stage:warning",
        stageName,
        message: `Output token limit reached (hit ${lengthContinues} time${lengthContinues > 1 ? "s" : ""})`,
      });

      if (lengthContinues <= MAX_LENGTH_CONTINUES && i < maxIterations - 1) {
        const continueMsg: Message = {
          role: "user",
          content:
            "Your response was cut off because you hit the output token limit. Continue exactly where you left off.",
        };
        exchange.push(continueMsg);
        fullHistory.push(continueMsg);
        lastExchange = exchange;
        continue;
      }

      if (config.onTokenLimit) {
        const summary = { filesWritten: [...filesWritten], commandsRun: [...commandsRun] };
        const shouldContinue = await config.onTokenLimit(summary);
        if (shouldContinue) {
          lengthContinues = 0;
          const continueMsg: Message = {
            role: "user",
            content:
              "The user has confirmed you should continue. Pick up where you left off and keep working.",
          };
          exchange.push(continueMsg);
          fullHistory.push(continueMsg);
          lastExchange = exchange;
          continue;
        }
      }

      stopReason = "token_limit";
      break;
    }

    // ── Handle "stop" or no tool calls — model decided to stop ──
    if (response.finishReason !== "tool_calls" || !response.toolCalls?.length) {
      lengthContinues = 0;
      stopReason = "done";
      break;
    }

    // ── Execute tool calls ───────────────────────────────────
    lengthContinues = 0;
    const iterationSummaries: string[] = [];

    for (const toolCall of response.toolCalls) {
      if (signal?.aborted) {
        stopReason = "cancelled";
        return err(new Error("Pipeline execution was cancelled"));
      }

      const toolName = toolCall.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      } catch {
        // If args aren't valid JSON, pass empty
      }

      const argsJson = JSON.stringify(args);

      // ── Doom loop check ──────────────────────────────────
      const cachedResult = checkDoomLoop(recentCalls, toolName, argsJson, cachedResults);
      if (cachedResult !== null) {
        eventBus.emit({
          type: "stage:warning",
          stageName,
          message: `Doom loop detected: ${toolName} called ${DOOM_LOOP_THRESHOLD} times with identical args`,
        });

        // Return cached result + warning instead of re-executing
        const warningContent = `[Loop detected: you have called ${toolName} with the same arguments ${DOOM_LOOP_THRESHOLD} times. Returning cached result. Move on to the next step of your task.]\n\n${cachedResult}`;
        const toolMsg: Message = {
          role: "tool",
          content: warningContent,
          tool_call_id: toolCall.id,
        };
        exchange.push(toolMsg);
        fullHistory.push(toolMsg);

        recentCalls.push({ tool: toolName, args: argsJson });
        iterationSummaries.push(
          `${toolName}(${getKeyArg(toolName, args) ?? ""}) → LOOP (cached)`,
        );
        continue;
      }

      // Track work done
      if (toolName === "write_file" && typeof args.path === "string") {
        filesWritten.push(args.path);
      } else if (toolName === "run_command" && typeof args.command === "string") {
        commandsRun.push(
          args.command.length > 60 ? `${args.command.slice(0, 60)}…` : args.command,
        );
      }

      eventBus.emit({ type: "tool:call", stageName, toolName, args });

      const start = Date.now();
      const toolResult = await registry.execute(toolName, args);
      const durationMs = Date.now() - start;

      let resultContent = toolResult.ok
        ? toolResult.value
        : JSON.stringify({ error: toolResult.error.message });

      // ── Truncate large tool outputs ────────────────────────
      resultContent = truncateToolOutput(resultContent);

      eventBus.emit({
        type: "tool:result",
        stageName,
        toolName,
        durationMs,
        success: toolResult.ok,
      });

      const toolMsg: Message = {
        role: "tool",
        content: resultContent,
        tool_call_id: toolCall.id,
      };
      exchange.push(toolMsg);
      fullHistory.push(toolMsg);

      // Track for doom loop detection
      recentCalls.push({ tool: toolName, args: argsJson });
      const cacheKey = `${toolName}:${argsJson}`;
      if (!cachedResults.has(cacheKey)) {
        cachedResults.set(cacheKey, resultContent);
      }

      // Build compact summary for the action log
      iterationSummaries.push(summarizeToolCall(toolName, args, toolResult.ok, resultContent));
    }

    // Auto-append to action log
    memory.actionLog.push(`[${iterations}] ${iterationSummaries.join(" | ")}`);

    lastExchange = exchange;
  }

  if (iterations >= maxIterations && stopReason === "done") {
    stopReason = "max_iterations";
  }

  const workSummary = { filesWritten, commandsRun };
  return ok({ finalContent, messages: fullHistory, totalUsage, iterations, stopReason, workSummary });
}

