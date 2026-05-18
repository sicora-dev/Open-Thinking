/**
 * Risk classification for tool actions.
 *
 * Classifies each tool invocation into one of three risk levels:
 * - safe: read-only operations (auto-allowed in confirm mode)
 * - moderate: write operations within the workspace
 * - dangerous: destructive commands, writes outside workspace
 */
import { resolve } from "node:path";
import type { RiskLevel } from "./permission-types";

/** Patterns that indicate a destructive shell command. */
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s/,
  /\brm$/,
  /\brmdir\b/,
  /\bsudo\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bmkfs\b/,
  /\bdd\b/,
  /\b>\s*\//, // redirect to absolute path
  /\bgit\s+push\b.*--force/,
  /\bgit\s+reset\s+--hard/,
  /\bgit\s+clean\b/,
  /\bkill\b/,
  /\bpkill\b/,
  /\breboot\b/,
  /\bshutdown\b/,
  /\bcurl\b.*\|\s*(bash|sh|zsh)/, // pipe to shell
];

/** Commands generally considered safe. */
const SAFE_COMMAND_PREFIXES = [
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "rg",
  "find",
  "wc",
  "echo",
  "pwd",
  "which",
  "env",
  "printenv",
  "date",
  "whoami",
  "uname",
  "node --version",
  "bun --version",
  "npm --version",
  "git status",
  "git log",
  "git diff",
  "git branch",
  "git show",
  "git blame",
];

export function classifyToolRisk(
  tool: string,
  args: Record<string, unknown>,
  workingDir: string,
): { risk: RiskLevel; subject: string; description: string } {
  switch (tool) {
    case "read_file":
    case "list_files":
    case "search_files":
    case "get_context":
      return {
        risk: "safe",
        subject: String(args.path ?? args.key ?? ""),
        description: `${tool}: ${args.path ?? args.key ?? ""}`,
      };

    case "write_file": {
      const path = String(args.path ?? "");
      const resolved = resolve(workingDir, path);
      const isOutside = !resolved.startsWith(resolve(workingDir));
      return {
        risk: isOutside ? "dangerous" : "moderate",
        subject: path,
        description: isOutside
          ? `write_file: ${path} (OUTSIDE workspace)`
          : `write_file: ${path}`,
      };
    }

    case "run_command": {
      const command = String(args.command ?? "");
      const trimmed = command.trim();

      // Check for dangerous patterns
      for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
        if (pattern.test(trimmed)) {
          return {
            risk: "dangerous",
            subject: command,
            description: `run_command: ${truncateCommand(command)} (destructive)`,
          };
        }
      }

      // Check for safe commands
      for (const prefix of SAFE_COMMAND_PREFIXES) {
        if (trimmed === prefix || trimmed.startsWith(`${prefix} `)) {
          return {
            risk: "safe",
            subject: command,
            description: `run_command: ${truncateCommand(command)}`,
          };
        }
      }

      // Unknown commands are moderate risk
      return {
        risk: "moderate",
        subject: command,
        description: `run_command: ${truncateCommand(command)}`,
      };
    }

    default:
      return {
        risk: "moderate",
        subject: tool,
        description: `${tool}: ${JSON.stringify(args).slice(0, 100)}`,
      };
  }
}

function truncateCommand(command: string): string {
  return command.length > 80 ? `${command.slice(0, 77)}...` : command;
}
