/**
 * Permission system types.
 *
 * Classifies tool actions by risk level and provides a persistent
 * rule store so users can "allow always" or "deny always" specific
 * tool + pattern combinations — like Claude Code's permission model.
 */

/** Permission modes, ordered from most to least permissive. */
export type PermissionMode = "auto" | "sandbox" | "confirm" | "strict";

/** The action to take for a given tool invocation. */
export type PermissionAction = "allow" | "deny";

/** A persisted permission rule (allow/deny for a tool + glob pattern). */
export type PermissionRule = {
  tool: string;
  /** Glob pattern for the primary argument (path for file tools, command for run_command). */
  pattern: string;
  action: PermissionAction;
  /** ISO timestamp when this rule was created. */
  createdAt: string;
};

/** Risk classification for a tool action. */
export type RiskLevel = "safe" | "moderate" | "dangerous";

/** A pending permission request that needs human resolution. */
export type PermissionRequest = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  description: string;
  /** The primary value being checked (file path, command, etc.). */
  subject: string;
};

/** How the human resolved a permission request. */
export type PermissionResponse = {
  action: PermissionAction;
  /** If true, persist as a permanent rule. */
  remember: boolean;
};

/** Events emitted by the permission system. */
export type PermissionEvent =
  | { type: "permission:request"; request: PermissionRequest; stageName: string }
  | { type: "permission:granted"; requestId: string; stageName: string; remembered: boolean }
  | { type: "permission:denied"; requestId: string; stageName: string; remembered: boolean }
  | { type: "permission:auto-allowed"; tool: string; subject: string; stageName: string };
