/**
 * Persistent storage for permission rules.
 *
 * Rules are stored in ~/.openthk/permissions.json and loaded on startup.
 * Each rule maps a (tool, pattern) pair to an action (allow/deny).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getOpenthkConfigDir } from "../../config/paths";
import type { PermissionAction, PermissionRule } from "./permission-types";

type PermissionsFile = {
  rules: PermissionRule[];
};

function getPermissionsPath(): string {
  return join(getOpenthkConfigDir(), "permissions.json");
}

function loadFile(): PermissionsFile {
  const path = getPermissionsPath();
  if (!existsSync(path)) return { rules: [] };
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PermissionsFile;
  } catch {
    return { rules: [] };
  }
}

function saveFile(data: PermissionsFile): void {
  writeFileSync(getPermissionsPath(), JSON.stringify(data, null, 2), { mode: 0o600 });
}

/**
 * Simple glob matching for permission patterns.
 * Supports `*` (any segment within a path) and `**` (any depth).
 * Path separators are `/`.
 */
function matchPattern(pattern: string, value: string): boolean {
  // Exact match
  if (pattern === value) return true;
  // Wildcard: match everything
  if (pattern === "**" || pattern === "*") return true;

  // Convert glob to regex
  const regexStr = pattern
    .split("**")
    .map((segment) =>
      segment
        .split("*")
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  try {
    return new RegExp(`^${regexStr}$`).test(value);
  } catch {
    return pattern === value;
  }
}

export type PermissionStore = {
  /** Find a matching rule for a tool + subject. Returns null if no rule matches. */
  findRule(tool: string, subject: string): PermissionRule | null;
  /** Add a persistent rule. */
  addRule(tool: string, pattern: string, action: PermissionAction): void;
  /** Remove rules matching a tool and optional pattern. */
  removeRule(tool: string, pattern?: string): number;
  /** List all rules. */
  listRules(): PermissionRule[];
  /** Remove all rules. */
  clearRules(): void;
};

export function createPermissionStore(): PermissionStore {
  function findRule(tool: string, subject: string): PermissionRule | null {
    const { rules } = loadFile();
    // Most specific rule wins (exact match > glob > wildcard)
    // Search in reverse order so later rules override earlier ones
    for (let i = rules.length - 1; i >= 0; i--) {
      const rule = rules[i];
      if (!rule) continue;
      if (rule.tool === tool && matchPattern(rule.pattern, subject)) {
        return rule;
      }
      // Wildcard tool match
      if (rule.tool === "*" && matchPattern(rule.pattern, subject)) {
        return rule;
      }
    }
    return null;
  }

  function addRule(tool: string, pattern: string, action: PermissionAction): void {
    const data = loadFile();
    // Remove existing rule with same tool + pattern
    data.rules = data.rules.filter((r) => !(r.tool === tool && r.pattern === pattern));
    data.rules.push({
      tool,
      pattern,
      action,
      createdAt: new Date().toISOString(),
    });
    saveFile(data);
  }

  function removeRule(tool: string, pattern?: string): number {
    const data = loadFile();
    const before = data.rules.length;
    data.rules = data.rules.filter((r) => {
      if (r.tool !== tool) return true;
      if (pattern && r.pattern !== pattern) return true;
      return false;
    });
    saveFile(data);
    return before - data.rules.length;
  }

  function listRules(): PermissionRule[] {
    return loadFile().rules;
  }

  function clearRules(): void {
    saveFile({ rules: [] });
  }

  return { findRule, addRule, removeRule, listRules, clearRules };
}
