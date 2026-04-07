/**
 * Delegate tool: allows an orchestrator stage to invoke other stages
 * as sub-agents during orchestrated pipeline execution.
 *
 * The orchestrator calls `delegate(agent, task)` and the target stage
 * runs its full agent loop. The output is returned as the tool result.
 */
import type { EventBus } from "../core/events/event-bus";
import type { PolicyEngine } from "../policies/engine";
import { loadSkillDefinition } from "../skills/catalog";
import { type Result, err, ok } from "../shared/result";
import type {
  ChatRequest,
  ContextStore,
  LLMProvider,
  PipelineConfig,
  StageDefinition,
  ToolFunction,
} from "../shared/types";
import { formatPersistentContext, loadStageContext } from "../workspace";
import { createToolRegistry } from "./tool-registry";

export type DelegateDeps = {
  config: PipelineConfig;
  providers: Record<string, LLMProvider>;
  contextStore: ContextStore;
  policyEngine: PolicyEngine;
  eventBus: EventBus;
  workingDir: string;
  skillsDir?: string | string[];
  signal?: AbortSignal;
  onTokenLimit?: (stageName: string, summary: { filesWritten: string[]; commandsRun: string[] }) => Promise<boolean>;
  /** Dynamically imported to avoid circular deps. Set by the executor before use. */
  runAgentLoop: (config: import("../pipeline/executor/agent-loop").AgentLoopConfig) => Promise<Result<import("../pipeline/executor/agent-loop").AgentLoopResult>>;
};

/**
 * Create the delegate tool for an orchestrator.
 * The tool executes the target stage's full agent loop and returns its output.
 */
export function createDelegateTool(deps: DelegateDeps): ToolFunction {
  const availableAgents = Object.entries(deps.config.stages)
    .filter(([, s]) => s.role !== "orchestrator")
    .map(([name]) => name);

  return {
    name: "delegate",
    description:
      `Delegate a task to a specialized agent. Available agents: ${availableAgents.join(", ")}. ` +
      "The agent will execute autonomously with its own tools and return the result.",
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: `The agent to delegate to. One of: ${availableAgents.join(", ")}`,
          enum: availableAgents,
        },
        task: {
          type: "string",
          description: "Clear description of what the agent should accomplish",
        },
      },
      required: ["agent", "task"],
    },
    async execute(args): Promise<Result<unknown>> {
      const agentName = args.agent as string;
      const task = args.task as string;

      if (!availableAgents.includes(agentName)) {
        return err(new Error(`Unknown agent "${agentName}". Available: ${availableAgents.join(", ")}`));
      }

      const stageDef = deps.config.stages[agentName];
      if (!stageDef) {
        return err(new Error(`Stage definition not found for "${agentName}"`));
      }

      const provider = deps.providers[stageDef.provider];
      if (!provider) {
        return err(new Error(`Provider "${stageDef.provider}" not found for agent "${agentName}"`));
      }

      const delegateStart = Date.now();

      // Emit delegate:start
      deps.eventBus.emit({
        type: "delegate:start",
        agentName,
        model: stageDef.model,
        task,
      });

      // Build context payload for the agent (lazy index by default)
      const allEntries = await deps.contextStore.list();
      const contextBlock = allEntries.ok
        ? buildContextBlock(
            agentName,
            stageDef,
            allEntries.value,
            deps.policyEngine,
            stageDef.context.eager === true,
          )
        : "";
      const contextBytes = new TextEncoder().encode(contextBlock).length;

      // Load skill
      const skill = loadSkillDefinition(stageDef.skill, deps.skillsDir);
      const allowedTools = stageDef.allowed_tools ?? skill.allowedTools ?? undefined;
      const toolRegistry = createToolRegistry(deps.workingDir, allowedTools, {
        contextStore: deps.contextStore,
        permissions: stageDef.context,
        policyEngine: deps.policyEngine,
        stageName: agentName,
      });

      // Build persistent context
      const persistentCtx = loadStageContext(deps.workingDir, agentName);
      const persistentBlock = formatPersistentContext(persistentCtx);
      const persistentBytes = new TextEncoder().encode(persistentBlock).length;

      const basePrompt = skill.prompt ?? `You are the "${agentName}" agent in an AI pipeline.`;
      const systemPrompt = persistentBlock
        ? `${basePrompt}\n\n--- Persistent Context ---\n${persistentBlock}`
        : basePrompt;

      const request: ChatRequest = {
        model: stageDef.model,
        messages: [
          {
            role: "user",
            content: `${task}${contextBlock ? `\n\n${contextBlock}` : ""}`,
          },
        ],
        systemPrompt,
        maxTokens: stageDef.max_tokens ?? 16384,
        temperature: stageDef.temperature,
        tools: toolRegistry.definitions(),
        timeoutMs: stageDef.timeout ? stageDef.timeout * 1000 : undefined,
      };

      const maxIterations = stageDef.max_iterations ?? 50;
      const loopResult = await deps.runAgentLoop({
        provider,
        request,
        toolRegistry,
        maxIterations,
        eventBus: deps.eventBus,
        stageName: agentName,
        providerType: deps.config.providers[stageDef.provider]?.type,
        initialContextBytes: contextBytes,
        initialPersistentContextBytes: persistentBytes,
        signal: deps.signal,
        onTokenLimit: deps.onTokenLimit
          ? (summary) => deps.onTokenLimit!(agentName, summary)
          : undefined,
      });

      if (!loopResult.ok) {
        deps.eventBus.emit({
          type: "delegate:error",
          agentName,
          error: loopResult.error.message,
        });
        return err(new Error(`Agent "${agentName}" failed: ${loopResult.error.message}`));
      }

      const agentResult = loopResult.value;

      // Write agent output to context store
      const outputKey = `${agentName}.output`;
      const writeCheck = deps.policyEngine.checkWrite(agentName, stageDef.context, outputKey);
      if (writeCheck.ok) {
        await deps.contextStore.set(outputKey, agentResult.finalContent, agentName);
        deps.eventBus.emit({ type: "context:write", stageName: agentName, key: outputKey });
      }

      const delegateDuration = Date.now() - delegateStart;

      // Emit delegate:complete
      deps.eventBus.emit({
        type: "delegate:complete",
        agentName,
        durationMs: delegateDuration,
        result: {
          stageName: agentName,
          status: "success",
          output: agentResult.finalContent,
          usage: agentResult.totalUsage,
          durationMs: delegateDuration,
          contextKeysWritten: writeCheck.ok ? [outputKey] : [],
          stopReason: agentResult.stopReason,
          workSummary: agentResult.workSummary,
        },
      });

      // Token-efficient return: instead of feeding the agent's entire
      // output back into the orchestrator's prompt (which would double
      // the token cost — once at write time, once at read time), we
      // return a compact summary plus a reference to the context key.
      // The orchestrator can call `get_context("<agent>.output")` if it
      // genuinely needs the full body.
      const fullOutput = agentResult.finalContent;
      const fullBytes = new TextEncoder().encode(fullOutput).length;
      const summary = buildDelegateSummary(
        agentName,
        outputKey,
        fullOutput,
        fullBytes,
        agentResult.workSummary,
      );
      return ok(summary);
    },
  };
}

/**
 * Build a compact, model-readable summary of a delegated agent run.
 *
 * Includes:
 * - the context key where the full output lives,
 * - a 200-character preview of the output,
 * - what files/commands the agent touched.
 *
 * This replaces the full output as the tool result, saving tokens in
 * the orchestrator's prompt history. The orchestrator can fetch the
 * full body via `get_context(<key>)` when needed.
 */
function buildDelegateSummary(
  agentName: string,
  outputKey: string,
  output: string,
  bytes: number,
  work: { filesWritten: string[]; commandsRun: string[] },
): string {
  const sizeLabel = bytes < 1024 ? `${bytes}B` : `${(bytes / 1024).toFixed(1)}KB`;
  const preview = output.length > 200 ? `${output.slice(0, 200)}…` : output;

  const lines = [
    `Agent "${agentName}" completed.`,
    `Full output: ${sizeLabel}, stored in context key "${outputKey}".`,
    `Use get_context("${outputKey}") to fetch the full body if you need it.`,
  ];

  if (work.filesWritten.length > 0) {
    const filesPreview =
      work.filesWritten.length > 5
        ? `${work.filesWritten.slice(0, 5).join(", ")} (+${work.filesWritten.length - 5} more)`
        : work.filesWritten.join(", ");
    lines.push(`Files written: ${filesPreview}`);
  }
  if (work.commandsRun.length > 0) {
    lines.push(`Commands run: ${work.commandsRun.length}`);
  }

  lines.push("", "--- Output preview ---", preview);
  return lines.join("\n");
}

/**
 * Bytes under which a context entry is always inlined eagerly.
 * Mirrors the threshold in stage-executor.ts.
 */
const EAGER_INLINE_THRESHOLD = 500;

/**
 * Build the context block for a delegated agent based on its read permissions.
 *
 * Honors the lazy-context contract: by default only an *index* is sent;
 * the agent uses `get_context(key)` to pull large entries on demand.
 * Pass `eager=true` to inline everything (legacy / explicit opt-in).
 */
function buildContextBlock(
  stageName: string,
  stageDef: StageDefinition,
  entries: import("../shared/types").ContextEntry[],
  policyEngine: PolicyEngine,
  eager: boolean,
): string {
  const readableKeys = policyEngine.filterReadable(
    stageDef.context,
    entries.map((e) => e.key),
  );

  if (readableKeys.length === 0) return "";

  type Item = { key: string; value: string; size: number };
  const items: Item[] = [];
  for (const key of readableKeys) {
    const entry = entries.find((e) => e.key === key);
    if (!entry) continue;
    const check = policyEngine.checkRead(stageName, stageDef.context, key);
    if (!check.ok) continue;
    items.push({
      key,
      value: entry.value,
      size: new TextEncoder().encode(entry.value).length,
    });
  }

  if (items.length === 0) return "";

  if (eager) {
    const lines = items.map((i) => `[${i.key}]\n${i.value}`);
    return `--- Context ---\n${lines.join("\n\n")}\n--- End Context ---`;
  }

  const inlineParts: string[] = [];
  const indexLines: string[] = [];
  for (const item of items) {
    if (item.size <= EAGER_INLINE_THRESHOLD) {
      inlineParts.push(`[${item.key}]\n${item.value}`);
      indexLines.push(`  - ${item.key} (${item.size}B, inlined above)`);
    } else {
      const sizeLabel =
        item.size < 1024 ? `${item.size}B` : `${(item.size / 1024).toFixed(1)}KB`;
      indexLines.push(`  - ${item.key} (${sizeLabel}, fetch with get_context("${item.key}"))`);
    }
  }

  const sections: string[] = [];
  if (inlineParts.length > 0) {
    sections.push(`--- Context (inlined) ---\n${inlineParts.join("\n\n")}\n--- End Context ---`);
  }
  sections.push(`--- Available context keys ---\n${indexLines.join("\n")}\n--- End ---`);
  return sections.join("\n\n");
}
