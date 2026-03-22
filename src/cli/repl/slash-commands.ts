/**
 * Slash command definitions and router for the interactive REPL.
 * Commands are prefixed with `/` and handle configuration, inspection, etc.
 */
import { copyFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { type ProviderEntry, listProviders, removeProvider, runSetupWizard } from "../../config";
import { parsePipeline } from "../../pipeline/parser";
import type { PipelineConfig, StageDefinition } from "../../shared/types";
import {
  type PipelineEntry,
  type PipelineOrigin,
  clearPipelineDefault,
  findPipelineConflicts,
  getActivePipelineName,
  getGlobalDir,
  getPipelineDefault,
  getProjectDir,
  initProjectWorkspace,
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
  lines.push(`  Mode: ${cfg.mode}`);
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

  // Execution order
  if (cfg.mode === "orchestrated") {
    const orchestrator = Object.entries(cfg.stages).find(([, s]) => s.role === "orchestrator");
    const agents = Object.entries(cfg.stages).filter(([, s]) => s.role !== "orchestrator");
    if (orchestrator) {
      lines.push(`  Execution: dynamic (orchestrator-driven)`);
      lines.push(`    Orchestrator: ${orchestrator[0]}`);
      lines.push(`    Agents: ${agents.map(([n]) => n).join(", ")}`);
      lines.push("");
    }
  } else {
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
  }

  // Stages detail
  const stageLabel = cfg.mode === "orchestrated" ? "Stages" : "Stages";
  lines.push(`  ${stageLabel}`);
  for (const [name, stage] of Object.entries(cfg.stages)) {
    const roleTag = stage.role === "orchestrator" ? " [orchestrator]" : "";
    lines.push(`    ${name}${roleTag}`);
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
    if (stage.timeout) lines.push(`      timeout:  ${stage.timeout}s`);
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
    description: "Manage pipelines: show, list, add, remove, switch, refresh, default",
    usage: "[list|add <path> [project|user]|remove <name> [project|user]|switch <name>|refresh [name]|default <name> <project|user|clear>|load <path>]",
    async execute(args, state) {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0] || "";

      // /pipeline — show full pipeline design
      if (!subcommand) {
        if (!state.pipelineConfig) {
          return { output: "  No pipeline loaded. Use /pipeline add <path> or /pipeline list." };
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
              "  Use /pipeline add <path> to register one.",
          };
        }

        const activeName = getActivePipelineName(state.workingDir);
        const projectPipelines = pipelines.filter((p) => p.origin === "project");
        const userPipelines = pipelines.filter((p) => p.origin === "user");

        // Build default lookup: which names have a stored preference?
        const allNames = [...new Set(pipelines.map((p) => p.name))];
        const defaults = new Map<string, PipelineOrigin>();
        for (const name of allNames) {
          const pref = getPipelineDefault(state.workingDir, name);
          if (pref) defaults.set(name, pref);
        }

        function formatEntry(p: PipelineEntry): string {
          const isActive = activeName === p.name && state.pipelineConfig ? "●" : " ";
          const isDefault = defaults.get(p.name) === p.origin ? " (default)" : "";
          return `    ${isActive} ${p.name}${isDefault}`;
        }

        const lines: string[] = [];

        if (projectPipelines.length > 0) {
          lines.push("  Project (.openmind/pipelines/)");
          for (const p of projectPipelines) lines.push(formatEntry(p));
        }

        if (userPipelines.length > 0) {
          if (projectPipelines.length > 0) lines.push("");
          lines.push("  User (~/.openmind/pipelines/)");
          for (const p of userPipelines) lines.push(formatEntry(p));
        }

        // Detect conflicts
        const names = pipelines.map((p) => p.name);
        const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
        const conflictWarnings = [...new Set(duplicates)]
          .filter((n) => !defaults.has(n))
          .map(
            (n) => `  ⚠ "${n}" exists in both project and user. Use /pipeline default ${n} <project|user> to set preference.`,
          );

        return {
          output: [
            ...lines,
            ...(conflictWarnings.length > 0 ? ["", ...conflictWarnings] : []),
          ].join("\n"),
        };
      }

      // /pipeline add <path> [project|user]
      if (subcommand === "add") {
        const rawPath = parts[1];
        const target: PipelineOrigin = (parts[2] as PipelineOrigin) || "project";
        if (!rawPath) {
          return { output: "  Usage: /pipeline add <path> [project|user]" };
        }
        if (target !== "project" && target !== "user") {
          return { output: `  Invalid target: "${target}". Use project or user.` };
        }

        const filePath = resolve(state.workingDir, rawPath);
        if (!existsSync(filePath)) {
          return { output: `  File not found: ${filePath}` };
        }

        // Validate it's a valid pipeline before copying
        const parseResult = await parsePipeline(filePath);
        if (!parseResult.ok) {
          return { output: `  Invalid pipeline: ${parseResult.error.message}` };
        }

        // Determine destination directory
        const destDir =
          target === "project"
            ? join(getProjectDir(state.workingDir), "pipelines")
            : join(getGlobalDir(), "pipelines");

        // Ensure target directories exist
        if (target === "project") {
          initProjectWorkspace(state.workingDir);
        }

        const fileName = basename(filePath);
        const destPath = join(destDir, fileName);

        if (existsSync(destPath)) {
          return { output: `  Pipeline already exists: ${destPath}\n  Remove it first with /pipeline remove.` };
        }

        copyFileSync(filePath, destPath);

        // Auto-load the pipeline and set it as active
        setActivePipeline(state.workingDir, parseResult.value.name);

        return {
          output: `  Added "${parseResult.value.name}" to [${target}] and set as active.`,
          stateUpdates: {
            pipelineConfig: parseResult.value,
            pipelinePath: destPath,
          },
        };
      }

      // /pipeline remove <name> [project|user]
      if (subcommand === "remove" || subcommand === "rm") {
        const name = parts[1];
        const originFilter = parts[2] as PipelineOrigin | undefined;
        if (!name) {
          return { output: "  Usage: /pipeline remove <name> [project|user]" };
        }

        const entries = findPipelineConflicts(state.workingDir, name);
        if (entries.length === 0) {
          return { output: `  Pipeline "${name}" not found.` };
        }

        // If origin specified, filter to that
        const toRemove = originFilter
          ? entries.filter((e) => e.origin === originFilter)
          : entries;

        if (toRemove.length === 0) {
          return { output: `  Pipeline "${name}" not found in [${originFilter}].` };
        }

        if (toRemove.length > 1 && !originFilter) {
          return {
            output: [
              `  "${name}" exists in both project and user.`,
              `  Specify which to remove: /pipeline remove ${name} project`,
              `  Or: /pipeline remove ${name} user`,
            ].join("\n"),
          };
        }

        const entry = toRemove[0]!;
        const { unlinkSync } = await import("node:fs");
        unlinkSync(entry.path);

        // If we removed the active pipeline, clear state
        const activeName = getActivePipelineName(state.workingDir);
        const stateUpdates: Partial<ReplState> = {};
        if (activeName === name) {
          stateUpdates.pipelineConfig = null;
          stateUpdates.pipelinePath = null;
        }

        return {
          output: `  Removed "${name}" from [${entry.origin}].`,
          stateUpdates: Object.keys(stateUpdates).length > 0 ? stateUpdates : undefined,
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
          return { output: "  Usage: /pipeline default <name> <project|user|clear>\n  Sets which origin to prefer when the same pipeline name exists in both project and user." };
        }

        // Validate the pipeline actually exists and has a conflict worth resolving
        const entries = findPipelineConflicts(state.workingDir, name);
        if (entries.length === 0) {
          return { output: `  Pipeline "${name}" not found. Use /pipeline add <path> to register one.` };
        }
        if (entries.length < 2 && action !== "clear") {
          return { output: `  "${name}" only exists in [${entries[0]!.origin}]. No conflict to resolve.` };
        }

        if (action === "clear") {
          clearPipelineDefault(state.workingDir, name);
          return { output: `  Cleared default for "${name}". Will ask next time there's a conflict.` };
        }

        if (action !== "project" && action !== "user") {
          return { output: `  Invalid origin: "${action}". Use project, user, or clear.` };
        }

        setPipelineDefault(state.workingDir, name, action as PipelineOrigin);
        return { output: `  Default for "${name}" set to [${action}].` };
      }

      // /pipeline refresh [name] — reload pipeline from disk
      if (subcommand === "refresh" || subcommand === "reload") {
        const name = parts[1];

        if (!name) {
          // Refresh the currently loaded pipeline
          if (!state.pipelinePath) {
            return { output: "  No pipeline loaded. Nothing to refresh." };
          }
          if (!existsSync(state.pipelinePath)) {
            return { output: `  Pipeline file no longer exists: ${state.pipelinePath}` };
          }
          const result = await parsePipeline(state.pipelinePath);
          if (!result.ok) {
            return { output: `  Error reloading pipeline: ${result.error.message}` };
          }
          return {
            output: `  Refreshed: ${result.value.name} v${result.value.version}`,
            stateUpdates: { pipelineConfig: result.value },
          };
        }

        // Refresh a specific pipeline by name
        const resolved = resolvePipelinePath(state.workingDir, name);
        if (resolved === null) {
          return { output: `  Pipeline "${name}" not found. Use /pipeline list to see available pipelines.` };
        }
        if ("conflict" in resolved) {
          return {
            output: `  ⚠ "${name}" exists in both project and user. Resolve with /pipeline default ${name} <project|user>.`,
          };
        }
        const result = await parsePipeline(resolved.path);
        if (!result.ok) {
          return { output: `  Error reloading pipeline: ${result.error.message}` };
        }
        return {
          output: `  Refreshed: ${result.value.name} v${result.value.version} [${resolved.origin}]`,
          stateUpdates: {
            pipelineConfig: result.value,
            pipelinePath: resolved.path,
          },
        };
      }

      // /pipeline load <path> — load from arbitrary file (temporary, not registered)
      if (subcommand === "load") {
        const rawPath = parts.slice(1).join(" ");
        if (!rawPath) {
          return { output: "  Usage: /pipeline load <path>" };
        }

        const filePath = resolve(state.workingDir, rawPath);
        if (!existsSync(filePath)) {
          return { output: `  File not found: ${filePath}` };
        }

        const result = await parsePipeline(filePath);
        if (!result.ok) {
          return { output: `  Error loading pipeline: ${result.error.message}` };
        }

        return {
          output: `  Loaded pipeline: ${result.value.name} v${result.value.version} (temporary — use /pipeline add to register)`,
          stateUpdates: {
            pipelineConfig: result.value,
            pipelinePath: filePath,
          },
        };
      }

      return { output: `  Unknown: /pipeline ${subcommand}. Type /help for usage.` };
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

export type CompletionEntry = {
  /** The text to insert (e.g. "/providers") */
  text: string;
  /** Short description shown next to it */
  description: string;
  /** If this is an alias, which command it aliases */
  aliasOf?: string;
};

/**
 * Get rich completion entries for the interactive autocomplete menu.
 */
export function getCompletionEntries(): CompletionEntry[] {
  const entries: CompletionEntry[] = [];
  for (const cmd of commands) {
    entries.push({ text: `/${cmd.name}`, description: cmd.description });
    for (const alias of cmd.aliases) {
      entries.push({ text: `/${alias}`, description: cmd.description, aliasOf: cmd.name });
    }
  }
  return entries;
}
