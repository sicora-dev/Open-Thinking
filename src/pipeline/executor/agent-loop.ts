/**
 * Agent loop: iteratively calls an LLM, executes tool calls, and feeds
 * results back until the model stops requesting tools.
 *
 * When the model stops, the loop builds a summary of what was done
 * (files written, commands run) and asks the model if the task is complete.
 * If the model says no, it continues. This lets the model itself decide
 * when it's done — no arbitrary thresholds.
 */
import type { EventBus } from "../../core/events/event-bus";
import { type Result, err, ok } from "../../shared/result";
import type { ChatRequest, LLMProvider, Message, TokenUsage } from "../../shared/types";
import type { ToolRegistry } from "../../tools";

export type AgentLoopConfig = {
  provider: LLMProvider;
  request: ChatRequest;
  toolRegistry: ToolRegistry;
  maxIterations: number;
  eventBus: EventBus;
  stageName: string;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
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
};

/**
 * Max times the loop will ask the model "are you done?" before accepting
 * a stop. Prevents infinite self-check loops.
 */
const MAX_COMPLETION_CHECKS = 2;

export async function runAgentLoop(config: AgentLoopConfig): Promise<Result<AgentLoopResult>> {
  const { provider, request, toolRegistry, maxIterations, eventBus, stageName, signal } = config;

  const messages: Message[] = [...request.messages];
  const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let finalContent = "";
  let iterations = 0;
  let completionChecks = 0;

  // Track what the model has done for the completion check
  const filesWritten: string[] = [];
  const commandsRun: string[] = [];

  for (let i = 0; i < maxIterations; i++) {
    // Check for cancellation before each iteration
    if (signal?.aborted) {
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

    // Accumulate usage
    totalUsage.promptTokens += response.usage.promptTokens;
    totalUsage.completionTokens += response.usage.completionTokens;
    totalUsage.totalTokens += response.usage.totalTokens;

    // Append assistant message
    const assistantMsg: Message = {
      role: "assistant",
      content: response.content,
      tool_calls: response.toolCalls,
    };
    messages.push(assistantMsg);

    // Capture latest content
    if (response.content) {
      finalContent = response.content;
    }

    // If no tool calls, the model wants to stop
    if (response.finishReason !== "tool_calls" || !response.toolCalls?.length) {
      // If the model has done work and we haven't asked too many times,
      // show it what it did and ask if it's really done
      if (
        filesWritten.length + commandsRun.length > 0 &&
        completionChecks < MAX_COMPLETION_CHECKS &&
        i < maxIterations - 1
      ) {
        completionChecks++;
        const summary = buildWorkSummary(filesWritten, commandsRun);
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
      // Accept the stop
      break;
    }

    // Execute each tool call
    for (const toolCall of response.toolCalls) {
      // Check for cancellation before each tool call
      if (signal?.aborted) {
        return err(new Error("Pipeline execution was cancelled"));
      }

      const toolName = toolCall.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      } catch {
        // If args aren't valid JSON, pass empty
      }

      // Track writes and commands for completion check
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

      // Append tool result message
      messages.push({
        role: "tool",
        content: resultContent,
        tool_call_id: toolCall.id,
      });
    }
  }

  return ok({ finalContent, messages, totalUsage, iterations });
}

/**
 * Build a human-readable summary of what the agent has done so far.
 */
function buildWorkSummary(filesWritten: string[], commandsRun: string[]): string {
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

  return lines.join("\n");
}
