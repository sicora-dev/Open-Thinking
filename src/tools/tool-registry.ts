/**
 * Tool registry: holds tool definitions and dispatches execution.
 */
import { type Result, err, ok } from "../shared/result";
import type { ToolDefinition, ToolFunction } from "../shared/types";
import {
  createListFilesTool,
  createReadFileTool,
  createRunCommandTool,
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
 * @param workingDir - Base directory for file operations.
 * @param allowedTools - If provided, only these tools are registered. Others are excluded.
 */
export function createToolRegistry(workingDir: string, allowedTools?: string[]): ToolRegistry {
  const tools = new Map<string, ToolFunction>();

  const builtins = [
    createReadFileTool(workingDir),
    createWriteFileTool(workingDir),
    createListFilesTool(workingDir),
    createRunCommandTool(workingDir),
    createSearchFilesTool(workingDir),
  ];

  const allowed = allowedTools ? new Set(allowedTools) : null;
  for (const tool of builtins) {
    if (!allowed || allowed.has(tool.name)) {
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
