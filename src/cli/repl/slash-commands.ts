/**
 * Slash command definitions and router for the interactive REPL.
 * Commands are prefixed with `/` and handle configuration, inspection, etc.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { type ProviderEntry, listProviders, removeProvider, runSetupWizard } from "../../config";
import { parsePipeline } from "../../pipeline/parser";
import type { PipelineConfig, StageDefinition } from "../../shared/types";
import {
  type PipelineOrigin,
  clearPipelineDefault,
  findPipelineConflicts,
  getActivePipelineName,
  listAvailablePipelines,
  resolvePipelinePath,
  setActivePipeline,
  setPipelineDefault,
} from "../../workspace";
import { resolveExecutionOrder } from "../../pipeline/executor";

export type ReplState = {
  pipelineConfig: PipelineConfig | null;
  pipelinePath: string | null;
  workingDir: string;
  skillsDir: string | null;
};

export type SlashCommandResult = {
  output: string;
  stateUpdates?: Partial<ReplState>;
  exit?: boolean;
};

type SlashCommand = {
  name: string;
  aliases: string[];
  description: string;
  usage?: string;
  execute: (args: string, state: ReplState) => Promise<SlashCommandResult>;
};

/**
 * Format a full visual view of the pipeline design.
 */
function formatPipelineView(cfg: PipelineConfig, state: ReplState): string {
  const lines: string[] = [];
  const activeName = getActivePipelineName(state.workingDir);

  // Header
  lines.push(`  ${cfg.name} v${cfg.version}`);
  if (state.pipelinePath) lines.push(`  ${state.pipelinePath}`);
  if (activeName) lines.push(`  Active as: ${activeName}`);
  lines.push("");

  // Providers
  const providerIds = Object.keys(cfg.providers);
  lines.push(`  Providers (${providerIds.length})`);
  for (const id of providerIds) {
    const p = cfg.providers[id]!;
    const keyStatus = p.api_key ? "key set" : "no key";
    lines.push(`    ${id}  ${p.type}  ${p.base_url}  (${keyStatus})`);
  }
  lines.push("");

  // Execution order (DAG layers)
  const orderResult = resolveExecutionOrder(cfg.stages);
  if (orderResult.ok) {
    const layers = orderResult.value;
    lines.push(`  Execution order (${layers.length} layer${layers.length !== 1 ? "s" : ""})`);
    for (const [i, layer] of layers.entries()) {
      const parallel = layer.length > 1 ? " (parallel)" : "";
      lines.push(`    ${i + 1}. ${layer.join(", ")}${parallel}`);
    }
    lines.push("");
  }

  // Stages detail
  lines.push("  Stages");
  for (const [name, stage] of Object.entries(cfg.stages)) {
    lines.push(`    ${name}`);
    lines.push(`      model:    ${stage.model} (via ${stage.provider})`);
    lines.push(`      skill:    ${stage.skill}`);

    if (stage.depends_on?.length) {
      lines.push(`      depends:  ${stage.depends_on.join(", ")}`);
    }

    const reads = stage.context.read.length > 0 ? stage.context.read.join(", ") : "none";
    const writes = stage.context.write.length > 0 ? stage.context.write.join(", ") : "none";
    lines.push(`      reads:    ${reads}`);
    lines.push(`      writes:   ${writes}`);

    if (stage.allowed_tools?.length) {
      lines.push(`      tools:    ${stage.allowed_tools.join(", ")}`);
    }

    if (stage.max_tokens) lines.push(`      tokens:   ${stage.max_tokens}`);
    if (stage.temperature !== undefined) lines.push(`      temp:     ${stage.temperature}`);
    if (stage.max_iterations) lines.push(`      max iter: ${stage.max_iterations}`);

    if (stage.on_fail) {
      lines.push(`      on_fail:  retry ${stage.on_fail.retry_stage} (max ${stage.on_fail.max_retries})`);
    }
    lines.push("");
  }

  // Policies
  const pol = cfg.policies.global;
  const policyParts: string[] = [];
  if (pol.rate_limit) policyParts.push(`rate: ${pol.rate_limit}`);
  if (pol.cost_limit) policyParts.push(`cost: ${pol.cost_limit}`);
  if (pol.audit_log) policyParts.push("audit: on");
  if (policyParts.length > 0) {
    lines.push(`  Policies: ${policyParts.join("  ")}`);
  }

  return lines.join("\n");
}

const commands: SlashCommand[] = [
  {
    name: "help",
    aliases: ["h", "?"],
    description: "Show available commands",
    async execute() {
      const lines = [
        "\n  Slash Commands:\n",
        ...commands.map((cmd) => {
          const aliases =
            cmd.aliases.length > 0 ? ` (${cmd.aliases.map((a) => `/${a}`).join(", ")})` : "";
          const usage = cmd.usage ? `  ${cmd.usage}` : "";
          return `    /${cmd.name}${aliases}${usage}\n      ${cmd.description}`;
        }),
        "\n  Type natural language to execute your pipeline.\n",
      ];
      return { output: lines.join("\n") };
    },
  },
  {
    name: "pipeline",
    aliases: ["p"],
    description: "Manage pipelines: show, list, switch, default, or load from path",
    usage: "[list|switch <name>|default <name> <project|user|clear>|<path>]",
    async execute(args, state) {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0] || "";

      // /pipeline — show full pipeline design
      if (!subcommand) {
        if (!state.pipelineConfig) {
          return { output: "  No pipeline loaded. Use /pipeline list or /pipeline <path>." };
        }
        return { output: formatPipelineView(state.pipelineConfig, state) };
      }

      // /pipeline list
      if (subcommand === "list" || subcommand === "ls") {
        const pipelines = listAvailablePipelines(state.workingDir);
        if (pipelines.length === 0) {
          return {
            output:
              "  No pipelines found.\n" +
              "  Place YAML files in .openmind/pipelines/ (project) or ~/.openmind/pipelines/ (personal).",
          };
        }

        const activeName = getActivePipelineName(state.workingDir);
        const lines = pipelines.map((p) => {
          const isActive = activeName === p.name && state.pipelineConfig ? "●" : " ";
          const origin = p.origin === "project" ? "[project]" : "[user]";
          return `    ${isActive} ${p.name}  ${origin}  ${p.path}`;
        });

        // Detect conflicts
        const names = pipelines.map((p) => p.name);
        const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
        const conflictWarnings = [...new Set(duplicates)].map(
          (n) => `  ⚠ "${n}" exists in both project and user. Use /pipeline default ${n} <project|user> to set preference.`,
        );

        return {
          output: [
            "  Available pipelines:\n",
            ...lines,
            ...(conflictWarnings.length > 0 ? ["", ...conflictWarnings] : []),
          ].join("\n"),
        };
      }

      // /pipeline switch <name>
      if (subcommand === "switch" || subcommand === "sw") {
        const name = parts[1];
        if (!name) return { output: "  Usage: /pipeline switch <name>" };

        const resolved = resolvePipelinePath(state.workingDir, name);

        if (resolved === null) {
          return { output: `  Pipeline "${name}" not found. Use /pipeline list to see available pipelines.` };
        }

        if ("conflict" in resolved) {
          const entries = resolved.conflict;
          const lines = entries.map((e) => `    - ${e.origin}: ${e.path}`);
          return {
            output: [
              `  ⚠ Found two pipelines named "${name}":`,
              ...lines,
              "",
              `  Set a default first: /pipeline default ${name} project`,
              `  Or: /pipeline default ${name} user`,
            ].join("\n"),
          };
        }

        const result = await parsePipeline(resolved.path);
        if (!result.ok) {
          return { output: `  Error loading pipeline: ${result.error.message}` };
        }

        setActivePipeline(state.workingDir, name);

        return {
          output: `  Switched to pipeline: ${result.value.name} v${result.value.version} [${resolved.origin}]`,
          stateUpdates: {
            pipelineConfig: result.value,
            pipelinePath: resolved.path,
          },
        };
      }

      // /pipeline default <name> <project|user|clear>
      if (subcommand === "default" || subcommand === "def") {
        const name = parts[1];
        const action = parts[2];
        if (!name || !action) {
          return { output: "  Usage: /pipeline default <name> <project|user|clear>" };
        }

        if (action === "clear") {
          clearPipelineDefault(state.workingDir, name);
          return { output: `  Cleared default for "${name}". Will ask next time there's a conflict.` };
        }

        if (action !== "project" && action !== "user") {
          return { output: `  Invalid origin: "${action}". Use project, user, or clear.` };
        }

        setPipelineDefault(state.workingDir, name, action as PipelineOrigin);
        return { output: `  Default for "${name}" set to [${action}] in this project.` };
      }

      // /pipeline <path> — load from arbitrary file (temporary, no active-pipeline update)
      const filePath = resolve(state.workingDir, args.trim());
      if (!existsSync(filePath)) {
        return { output: `  File not found: ${filePath}\n  Use /pipeline list to see available pipelines.` };
      }

      const result = await parsePipeline(filePath);
      if (!result.ok) {
        return { output: `  Error loading pipeline: ${result.error.message}` };
      }

      return {
        output: `  Loaded pipeline: ${result.value.name} v${result.value.version} (temporary — not saved as active)`,
        stateUpdates: {
          pipelineConfig: result.value,
          pipelinePath: filePath,
        },
      };
    },
  },
  {
    name: "providers",
    aliases: ["provider"],
    description: "Manage global API keys and providers",
    usage: "[setup|list|remove <id>]",
    async execute(args) {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0] || "list";

      if (subcommand === "setup" || subcommand === "add") {
        const count = await runSetupWizard();
        return { output: count > 0 ? "" : "  No providers configured." };
      }

      if (subcommand === "list") {
        const providers = listProviders();
        if (providers.length === 0) {
          return { output: "  No providers configured. Run /providers setup to add some." };
        }
        const lines = providers.map((p: ProviderEntry) => {
          const masked = p.apiKey
            ? ` ${p.apiKey.slice(0, 4)}${"•".repeat(8)}${p.apiKey.slice(-4)}`
            : " (no key)";
          return `    ${p.id}: ${p.name} @ ${p.baseUrl}${masked}`;
        });
        return { output: `  Global providers (~/.openmind):\n${lines.join("\n")}` };
      }

      if (subcommand === "remove" || subcommand === "rm") {
        const id = parts[1];
        if (!id) return { output: "  Usage: /providers remove <id>" };
        const result = removeProvider(id);
        if (!result.ok) return { output: `  Error: ${result.error.message}` };
        return {
          output: result.value ? `  Removed provider: ${id}` : `  Provider not found: ${id}`,
        };
      }

      return { output: `  Unknown: /providers ${subcommand}. Use setup, list, or remove.` };
    },
  },
  {
    name: "model",
    aliases: ["m"],
    description: "Show models used in each stage",
    async execute(_args, state) {
      if (!state.pipelineConfig) {
        return { output: "  No pipeline loaded." };
      }
      const lines = Object.entries(state.pipelineConfig.stages).map(([name, def]) => {
        return `    ${name}: ${def.model} (via ${def.provider})`;
      });
      return { output: `  Models:\n${lines.join("\n")}` };
    },
  },
  {
    name: "stages",
    aliases: ["s"],
    description: "Show pipeline stages and their dependencies",
    async execute(_args, state) {
      if (!state.pipelineConfig) {
        return { output: "  No pipeline loaded." };
      }
      const lines = Object.entries(state.pipelineConfig.stages).map(([name, def]) => {
        const deps = def.depends_on?.length ? ` → depends on: ${def.depends_on.join(", ")}` : "";
        const reads = def.context.read.join(", ") || "none";
        const writes = def.context.write.join(", ") || "none";
        return `    ${name}${deps}\n      reads: ${reads} | writes: ${writes}`;
      });
      return { output: `  Stages:\n${lines.join("\n")}` };
    },
  },
  {
    name: "skills",
    aliases: [],
    description: "List available skills",
    async execute(_args, state) {
      const skillsDir = state.skillsDir ?? join(state.workingDir, "skills");
      if (!existsSync(skillsDir)) {
        return { output: `  Skills directory not found: ${skillsDir}` };
      }

      const skills: string[] = [];
      try {
        const namespaces = readdirSync(skillsDir, { withFileTypes: true });
        for (const ns of namespaces) {
          if (!ns.isDirectory()) continue;
          const nsDir = join(skillsDir, ns.name);
          const entries = readdirSync(nsDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const promptPath = join(nsDir, entry.name, "prompt.md");
            const hasPrompt = existsSync(promptPath);
            skills.push(`    ${ns.name}/${entry.name}${hasPrompt ? "" : " (no prompt.md)"}`);
          }
        }
      } catch {
        return { output: `  Error reading skills directory: ${skillsDir}` };
      }

      if (skills.length === 0) {
        return { output: "  No skills found." };
      }
      return { output: `  Available skills:\n${skills.join("\n")}` };
    },
  },
  {
    name: "context",
    aliases: ["ctx"],
    description: "Inspect or clear the context store",
    usage: "[inspect|clear]",
    async execute(args) {
      const sub = args.trim() || "inspect";
      if (sub === "inspect" || sub === "clear") {
        return { output: `  Context ${sub}: available during pipeline execution.` };
      }
      return { output: `  Unknown: /context ${sub}. Use inspect or clear.` };
    },
  },
  {
    name: "clear",
    aliases: [],
    description: "Clear the terminal screen",
    async execute() {
      process.stdout.write("\x1b[2J\x1b[H");
      return { output: "" };
    },
  },
  {
    name: "exit",
    aliases: ["quit", "q"],
    description: "Exit OpenMind",
    async execute() {
      return { output: "Goodbye!", exit: true };
    },
  },
];

/**
 * Route a slash command string (without the leading `/`) to the right handler.
 */
export async function executeSlashCommand(
  input: string,
  state: ReplState,
): Promise<SlashCommandResult> {
  const trimmed = input.trim();
  const spaceIdx = trimmed.indexOf(" ");
  const commandName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

  const cmd = commands.find((c) => c.name === commandName || c.aliases.includes(commandName));

  if (!cmd) {
    return {
      output: `  Unknown command: /${commandName}. Type /help for available commands.`,
    };
  }

  return cmd.execute(args, state);
}

/**
 * Get all command names and aliases for autocompletion.
 */
export function getCommandCompletions(): string[] {
  const completions: string[] = [];
  for (const cmd of commands) {
    completions.push(`/${cmd.name}`);
    for (const alias of cmd.aliases) {
      completions.push(`/${alias}`);
    }
  }
  return completions;
}
