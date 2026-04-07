/**
 * Tool registry: holds tool definitions and dispatches execution.
 *
 * Stages are wired with the built-in filesystem tools and (optionally)
 * a policy-aware `get_context` tool that lets the LLM lazily fetch
 * entries from the shared context store. The lazy fetcher is the
 * cornerstone of token-efficient context loading.
 */
import type { PolicyEngine } from "../policies/engine";
import { type Result, err, ok } from "../shared/result";
import type {
  ContextStore,
  StageContextPermissions,
  ToolDefinition,
  ToolFunction,
} from "../shared/types";
import {
  createGetContextTool,
  createListFilesTool,
  createReadFileTool,
  createRunCommandTool,
  type ToolSessionState,
  createSearchFilesTool,
  createWriteFileTool,
} from "./built-in-tools";

export type ToolRegistry = {
  /** Get tool definitions to send to the LLM. */
  definitions(): ToolDefinition[];
  /** Execute a tool by name. Returns the result as a string. */
  execute(name: string, args: Record<string, unknown>): Promise<Result<string>>;
};

/**
 * Optional wiring for context-aware tools (`get_context`).
 *
 * When provided, the registry exposes `get_context` to the LLM and
 * routes its calls through the policy engine, so it can only fetch
 * keys the stage is allowed to read.
 */
export type ContextAccess = {
  contextStore: ContextStore;
  permissions: StageContextPermissions;
  policyEngine: PolicyEngine;
  stageName: string;
};

/**
 * @param workingDir - Base directory for file operations.
 * @param allowedTools - If provided, only these tools are registered. Others are excluded.
 * @param contextAccess - If provided, enables the lazy `get_context` tool.
 */
export function createToolRegistry(
  workingDir: string,
  allowedTools?: string[],
  contextAccess?: ContextAccess,
): ToolRegistry {
  const session: ToolSessionState = { fsEpoch: 0 };
  const tools = new Map<string, ToolFunction>();

  const builtins: ToolFunction[] = [
    createReadFileTool(workingDir, session),
    createWriteFileTool(workingDir, session),
    createListFilesTool(workingDir, session),
    createRunCommandTool(workingDir, session),
    createSearchFilesTool(workingDir),
  ];

  if (contextAccess) {
    builtins.push(
      createGetContextTool(
        contextAccess.contextStore,
        contextAccess.permissions,
        contextAccess.policyEngine,
        contextAccess.stageName,
      ),
    );
  }

  const allowed = allowedTools ? new Set(allowedTools) : null;
  for (const tool of builtins) {
    // get_context is always available when contextAccess is wired,
    // even if the stage's allowed_tools list does not mention it —
    // otherwise lazy context becomes unusable for restricted stages.
    if (!allowed || allowed.has(tool.name) || tool.name === "get_context") {
      tools.set(tool.name, tool);
    }
  }

  function definitions(): ToolDefinition[] {
    return [...tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  async function execute(name: string, args: Record<string, unknown>): Promise<Result<string>> {
    const tool = tools.get(name);
    if (!tool) return err(new Error(`Unknown tool: ${name}`));

    const result = await tool.execute(args);
    if (result.ok) {
      return ok(typeof result.value === "string" ? result.value : JSON.stringify(result.value));
    }
    return err(result.error);
  }

  return { definitions, execute };
}
