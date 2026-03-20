/**
 * Delegate tool: allows an orchestrator stage to invoke other stages
 * as sub-agents during orchestrated pipeline execution.
 *
 * The orchestrator calls `delegate(agent, task)` and the target stage
 * runs its full agent loop. The output is returned as the tool result.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { EventBus } from "../core/events/event-bus";
import type { PolicyEngine } from "../policies/engine";
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
  skillsDir: string;
  signal?: AbortSignal;
  onTokenLimit?: (stageName: string, summary: { filesWritten: string[]; commandsRun: string[] }) => Promise<boolean>;
  /** Dynamically imported to avoid circular deps. Set by the executor before use. */
  runAgentLoop: (config: import("../pipeline/executor/agent-loop").AgentLoopConfig) => Promise<Result<import("../pipeline/executor/agent-loop").AgentLoopResult>>;
};

/**
 * Load a skill's prompt.md and skill.yaml.
 */
function loadSkill(skillRef: string, skillsDir: string): { prompt: string | null; allowedTools: string[] | null } {
  const withoutVersion = skillRef.split("@")[0] ?? skillRef;
  const parts = withoutVersion.split("/");
  const first = parts[0] ?? withoutVersion;
  const skillDir =
    parts.length >= 2
      ? join(skillsDir, first, parts.slice(1).join("/"))
      : join(skillsDir, first);

  const promptPath = join(skillDir, "prompt.md");
  const prompt = existsSync(promptPath) ? readFileSync(promptPath, "utf-8").trim() : null;

  let allowedTools: string[] | null = null;
  const manifestPath = join(skillDir, "skill.yaml");
  if (existsSync(manifestPath)) {
    try {
      const raw = parseYaml(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
      if (Array.isArray(raw.allowed_tools)) {
        allowedTools = raw.allowed_tools as string[];
      }
    } catch {
      // Malformed manifest — fall back to defaults
    }
  }

  return { prompt, allowedTools };
}

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

      // Build context payload for the agent
      const allEntries = await deps.contextStore.list();
      const contextBlock = allEntries.ok
        ? buildContextBlock(agentName, stageDef, allEntries.value, deps.policyEngine)
        : "";

      // Load skill
      const skill = loadSkill(stageDef.skill, deps.skillsDir);
      const allowedTools = stageDef.allowed_tools ?? skill.allowedTools ?? undefined;
      const toolRegistry = createToolRegistry(deps.workingDir, allowedTools);

      // Build persistent context
      const persistentCtx = loadStageContext(deps.workingDir, agentName);
      const persistentBlock = formatPersistentContext(persistentCtx);

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

      return ok(agentResult.finalContent);
    },
  };
}

/**
 * Build the context block for a delegated agent based on its read permissions.
 */
function buildContextBlock(
  stageName: string,
  stageDef: StageDefinition,
  entries: import("../shared/types").ContextEntry[],
  policyEngine: PolicyEngine,
): string {
  const readableKeys = policyEngine.filterReadable(
    stageDef.context,
    entries.map((e) => e.key),
  );

  if (readableKeys.length === 0) return "";

  const lines = readableKeys
    .map((key) => {
      const entry = entries.find((e) => e.key === key);
      if (!entry) return null;
      const check = policyEngine.checkRead(stageName, stageDef.context, key);
      if (!check.ok) return null;
      return `[${key}]\n${entry.value}`;
    })
    .filter(Boolean);

  return lines.length > 0 ? `--- Context ---\n${lines.join("\n\n")}\n--- End Context ---` : "";
}
