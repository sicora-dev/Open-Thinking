/**
 * Tool registry: holds tool definitions and dispatches execution.
 *
 * Stages are wired with the built-in filesystem tools and (optionally)
 * a policy-aware `get_context` tool that lets the LLM lazily fetch
 * entries from the shared context store. The lazy fetcher is the
 * cornerstone of token-efficient context loading.
 *
 * When a PermissionEngine is provided, tool execution is gated by the
 * permission system: safe tools auto-pass, risky tools may block until
 * a human approves or denies the action.
 */
import type { PermissionEngine } from "../core/permissions";
import type { Sandbox } from "../core/sandbox";
import {
  createSandboxListFilesTool,
  createSandboxReadFileTool,
  createSandboxRunCommandTool,
  createSandboxWriteFileTool,
} from "../core/sandbox";
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
 * Optional permission wiring for human-in-the-loop approval.
 */
export type PermissionAccess = {
  engine: PermissionEngine;
  stageName: string;
};

/**
 * @param workingDir - Base directory for file operations.
 * @param allowedTools - If provided, only these tools are registered. Others are excluded.
 * @param contextAccess - If provided, enables the lazy `get_context` tool.
 * @param permissionAccess - If provided, gates tool execution through the permission engine.
 * @param sandbox - If provided, file operations are redirected through the sandbox.
 */
export function createToolRegistry(
  workingDir: string,
  allowedTools?: string[],
  contextAccess?: ContextAccess,
  permissionAccess?: PermissionAccess,
  sandbox?: Sandbox,
): ToolRegistry {
  const session: ToolSessionState = { fsEpoch: 0 };
  const tools = new Map<string, ToolFunction>();

  // When sandbox is active, use sandbox-wrapped tools for filesystem operations.
  // Read-only tools (search_files) still use the real FS — sandbox only affects writes.
  const builtins: ToolFunction[] = sandbox
    ? [
        createSandboxReadFileTool(workingDir, sandbox),
        createSandboxWriteFileTool(workingDir, sandbox),
        createSandboxListFilesTool(workingDir, sandbox),
        createSandboxRunCommandTool(workingDir, sandbox),
        createSearchFilesTool(workingDir),
      ]
    : [
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

    // Permission check (if engine is wired)
    if (permissionAccess) {
      const action = await permissionAccess.engine.check(
        name,
        args,
        permissionAccess.stageName,
      );
      if (action === "deny") {
        return err(new Error(`Permission denied for ${name}: ${args.path ?? args.command ?? ""}`));
      }
    }

    const result = await tool.execute(args);
    if (result.ok) {
      return ok(typeof result.value === "string" ? result.value : JSON.stringify(result.value));
    }
    return err(result.error);
  }

  return { definitions, execute };
}
