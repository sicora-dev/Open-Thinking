/**
 * Agent loop: iteratively calls an LLM, executes tool calls, and feeds
 * results back until the model stops requesting tools.
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

export async function runAgentLoop(config: AgentLoopConfig): Promise<Result<AgentLoopResult>> {
  const { provider, request, toolRegistry, maxIterations, eventBus, stageName } = config;

  const messages: Message[] = [...request.messages];
  const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let finalContent = "";
  let iterations = 0;

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

    // If no tool calls, we're done
    if (response.finishReason !== "tool_calls" || !response.toolCalls?.length) {
      break;
    }

    // Execute each tool call
    for (const toolCall of response.toolCalls) {
      const toolName = toolCall.function.name;
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
