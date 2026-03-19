/**
 * Agent loop: iteratively calls an LLM, executes tool calls, and feeds
 * results back until the model stops requesting tools.
 *
 * If the model stops early (few tool calls made), the loop sends a
 * continuation prompt to push the model to finish its work. This helps
 * with smaller models that tend to stop after scaffolding.
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

/** Max times we'll nudge the model to continue when it stops early. */
const MAX_CONTINUATIONS = 3;

/**
 * Minimum "write" tool calls (write_file, run_command) before we consider
 * the work substantial enough to accept a stop. Read-only calls (read_file,
 * list_files, search_files) don't count — they're just reconnaissance.
 */
const MIN_WRITE_CALLS_BEFORE_ACCEPT_STOP = 5;

const WRITE_TOOLS = new Set(["write_file", "run_command"]);

export async function runAgentLoop(config: AgentLoopConfig): Promise<Result<AgentLoopResult>> {
  const { provider, request, toolRegistry, maxIterations, eventBus, stageName } = config;

  const messages: Message[] = [...request.messages];
  const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let finalContent = "";
  let iterations = 0;
  let writeToolCalls = 0;
  let continuations = 0;

  for (let i = 0; i < maxIterations; i++) {
    iterations++;

    const chatResult = await provider.chat({
      ...request,
      messages,
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

    // If no tool calls, check if we should nudge the model to continue
    if (response.finishReason !== "tool_calls" || !response.toolCalls?.length) {
      // Only nudge if the model has written files/run commands but hasn't done
      // enough yet. This avoids nudging stages that only read or do simple Q&A.
      if (
        writeToolCalls > 0 &&
        writeToolCalls < MIN_WRITE_CALLS_BEFORE_ACCEPT_STOP &&
        continuations < MAX_CONTINUATIONS &&
        i < maxIterations - 1
      ) {
        continuations++;
        messages.push({
          role: "user",
          content:
            "You stopped but the task is not complete. Review the plan and continue implementing. " +
            "Use the tools to create all remaining files. Do not summarize — keep writing code.",
        });
        continue;
      }
      // Otherwise, accept the stop
      break;
    }

    // Execute each tool call
    for (const toolCall of response.toolCalls) {
      const toolName = toolCall.function.name;
      if (WRITE_TOOLS.has(toolName)) {
        writeToolCalls++;
      }
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      } catch {
        // If args aren't valid JSON, pass empty
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
