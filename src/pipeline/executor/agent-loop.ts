/**
 * Agent loop: iteratively calls an LLM, executes tool calls, and feeds
 * results back until the model stops requesting tools.
 *
 * Stop handling:
 * - "tool_calls": model wants to use tools → execute and continue
 * - "length": model hit token limit → ask user if they want to continue
 * - "stop": model decided to stop → check if work is complete
 *
 * When the model stops voluntarily, the loop shows what was done and asks
 * the model if the task is complete. If the model responds with text but
 * no tool calls (common with small models), it gets one more chance to
 * actually use tools before the check counts.
 */
import type { EventBus } from "../../core/events/event-bus";
import { type Result, err, ok } from "../../shared/result";
import type { ChatRequest, LLMProvider, Message, TokenUsage } from "../../shared/types";
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

/**
 * Max times the loop will ask the model "are you done?" before accepting
 * a stop. Prevents infinite self-check loops.
 */
const MAX_COMPLETION_CHECKS = 2;

/** Max consecutive "length" auto-continues before requiring user input. */
const MAX_LENGTH_CONTINUES = 3;

// ─── Tool result compaction ──────────────────────────────────

/**
 * Compact all tool result messages that the model has already processed.
 *
 * After the model responds to a batch of tool results, those results are
 * "consumed" — the model extracted what it needed and put it in its response.
 * Re-sending the full content on every subsequent iteration wastes tokens
 * quadratically.
 *
 * This function replaces consumed tool result content with a compact summary
 * like `[read_file: src/main.ts — 247 lines, 8.3KB]`, preserving the
 * tool_call_id so the conversation structure stays valid.
 */
function compactConsumedToolResults(messages: Message[]): void {
  // Find the last assistant message — everything before it has been processed.
  // Tool messages AFTER the last assistant message haven't been seen yet.
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  if (lastAssistantIdx <= 0) return;

  for (let i = 0; i < lastAssistantIdx; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== "tool") continue;
    // Already compacted — starts with "["
    if (msg.content.startsWith("[")) continue;

    const toolName = resolveToolName(messages, i, msg.tool_call_id);
    const lines = msg.content.split("\n").length;
    const bytes = new TextEncoder().encode(msg.content).length;

    msg.content = `[${toolName} — ${lines} line${lines !== 1 ? "s" : ""}, ${formatBytes(bytes)}]`;
  }
}

/**
 * Find the tool name for a given tool_call_id by searching backwards
 * for the assistant message that issued the call.
 */
function resolveToolName(messages: Message[], fromIdx: number, toolCallId?: string): string {
  if (!toolCallId) return "tool";

  for (let i = fromIdx - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "assistant" && msg.tool_calls) {
      const call = msg.tool_calls.find((tc) => tc.id === toolCallId);
      if (call) {
        // Extract key argument for context (path, command, pattern, etc.)
        const detail = extractToolDetail(call.function.name, call.function.arguments);
        return detail ? `${call.function.name}: ${detail}` : call.function.name;
      }
    }
  }

  return "tool";
}

/**
 * Extract a short identifying detail from tool arguments.
 * e.g., read_file → the file path, run_command → the command.
 */
function extractToolDetail(toolName: string, argsJson: string): string | null {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    switch (toolName) {
      case "read_file":
      case "write_file":
        return typeof args.path === "string" ? args.path : null;
      case "run_command":
        if (typeof args.command === "string") {
          return args.command.length > 80 ? `${args.command.slice(0, 80)}…` : args.command;
        }
        return null;
      case "search_files":
        return typeof args.pattern === "string" ? `"${args.pattern}"` : null;
      case "list_files":
        return typeof args.path === "string" ? args.path : null;
      case "delegate":
        return typeof args.agent === "string" ? args.agent : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export async function runAgentLoop(config: AgentLoopConfig): Promise<Result<AgentLoopResult>> {
  const { provider, request, toolRegistry, maxIterations, eventBus, stageName, signal } = config;

  const messages: Message[] = [...request.messages];
  const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let finalContent = "";
  let iterations = 0;
  let completionChecks = 0;
  let lengthContinues = 0;
  let stopReason: StopReason = "done";

  // Track what the model has done
  const filesWritten: string[] = [];
  const commandsRun: string[] = [];

  for (let i = 0; i < maxIterations; i++) {
    if (signal?.aborted) {
      stopReason = "cancelled";
      return err(new Error("Pipeline execution was cancelled"));
    }

    iterations++;

    const chatResult = await provider.chat({
      ...request,
      messages,
      signal,
    });

    if (!chatResult.ok) {
      return err(chatResult.error);
    }

    const response = chatResult.value;

    // Compact tool results the model has now processed — before we add
    // new messages, so the compaction only touches already-seen content.
    compactConsumedToolResults(messages);

    // Accumulate usage
    totalUsage.promptTokens += response.usage.promptTokens;
    totalUsage.completionTokens += response.usage.completionTokens;
    totalUsage.totalTokens += response.usage.totalTokens;

    // Append assistant message
    messages.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.toolCalls,
    });

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

      // Auto-continue a few times (the model was cut off, not done)
      if (lengthContinues <= MAX_LENGTH_CONTINUES && i < maxIterations - 1) {
        messages.push({
          role: "user",
          content: "Your response was cut off because you hit the output token limit. Continue exactly where you left off.",
        });
        continue;
      }

      // Too many length hits — ask user if they want to continue
      if (config.onTokenLimit) {
        const summary = { filesWritten: [...filesWritten], commandsRun: [...commandsRun] };
        const shouldContinue = await config.onTokenLimit(summary);
        if (shouldContinue) {
          lengthContinues = 0; // Reset counter
          messages.push({
            role: "user",
            content: "The user has confirmed you should continue. Pick up where you left off and keep working.",
          });
          continue;
        }
      }

      stopReason = "token_limit";
      break;
    }

    // ── Handle "stop" or no tool calls — model decided to stop ──
    if (response.finishReason !== "tool_calls" || !response.toolCalls?.length) {
      // Reset length counter since this was a voluntary stop
      lengthContinues = 0;

      if (
        filesWritten.length + commandsRun.length > 0 &&
        completionChecks < MAX_COMPLETION_CHECKS &&
        i < maxIterations - 1
      ) {
        // Check if the model responded with text but no tools (common with
        // small models that say "I'll continue" without actually calling tools).
        // Don't count this as a completion check — give it a direct nudge.
        const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;
        if (!hasToolCalls && completionChecks > 0) {
          // Already asked once, model responded with text only — nudge harder
          messages.push({
            role: "user",
            content:
              "You said you would continue but did not use any tools. " +
              "You MUST call write_file, run_command, or other tools now. Do not describe what you will do — do it.",
          });
          continue;
        }

        completionChecks++;
        const summary = buildWorkSummaryText(filesWritten, commandsRun);
        messages.push({
          role: "user",
          content:
            `You stopped. Here is what you have done so far:\n${summary}\n\n` +
            "Review your original task and the plan. Is everything complete? " +
            "If there are remaining files to create or steps to finish, continue working using the tools. " +
            "If everything is truly done, respond with just the word DONE.",
        });
        continue;
      }

      stopReason = "done";
      break;
    }

    // ── Execute tool calls ───────────────────────────────────
    // Reset length counter since the model is actively working
    lengthContinues = 0;

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

      // Track work done
      if (toolName === "write_file" && typeof args.path === "string") {
        filesWritten.push(args.path);
      } else if (toolName === "run_command" && typeof args.command === "string") {
        commandsRun.push(
          args.command.length > 60 ? `${args.command.slice(0, 60)}…` : args.command,
        );
      }

      eventBus.emit({
        type: "tool:call",
        stageName,
        toolName,
        args,
      });

      const start = Date.now();
      const toolResult = await toolRegistry.execute(toolName, args);
      const durationMs = Date.now() - start;

      const resultContent = toolResult.ok
        ? toolResult.value
        : JSON.stringify({ error: toolResult.error.message });

      eventBus.emit({
        type: "tool:result",
        stageName,
        toolName,
        durationMs,
        success: toolResult.ok,
      });

      messages.push({
        role: "tool",
        content: resultContent,
        tool_call_id: toolCall.id,
      });
    }
  }

  // If we exited the for loop naturally, it's max_iterations
  if (iterations >= maxIterations && stopReason === "done") {
    stopReason = "max_iterations";
  }

  const workSummary = { filesWritten, commandsRun };
  return ok({ finalContent, messages, totalUsage, iterations, stopReason, workSummary });
}

/**
 * Build a human-readable summary of what the agent has done so far.
 */
function buildWorkSummaryText(filesWritten: string[], commandsRun: string[]): string {
  const lines: string[] = [];

  if (filesWritten.length > 0) {
    lines.push(`Files written (${filesWritten.length}):`);
    for (const f of filesWritten) {
      lines.push(`  - ${f}`);
    }
  }

  if (commandsRun.length > 0) {
    lines.push(`Commands run (${commandsRun.length}):`);
    for (const c of commandsRun) {
      lines.push(`  - ${c}`);
    }
  }

  if (lines.length === 0) {
    lines.push("(no files written, no commands run)");
  }

  return lines.join("\n");
}
