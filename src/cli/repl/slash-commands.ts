/**
 * Slash command definitions and router for the interactive REPL.
 * Commands are prefixed with `/` and handle configuration, inspection, etc.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parsePipeline } from "../../pipeline/parser";
import type { PipelineConfig } from "../../shared/types";

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
    description: "Show or load a pipeline configuration",
    usage: "[path]",
    async execute(args, state) {
      if (!args) {
        if (!state.pipelineConfig) {
          return { output: "  No pipeline loaded. Use /pipeline <path> to load one." };
        }
        const cfg = state.pipelineConfig;
        const stageNames = Object.keys(cfg.stages).join(", ");
        const providerNames = Object.keys(cfg.providers).join(", ");
        return {
          output: [
            `  Pipeline: ${cfg.name} v${cfg.version}`,
            `  File: ${state.pipelinePath}`,
            `  Providers: ${providerNames}`,
            `  Stages: ${stageNames}`,
          ].join("\n"),
        };
      }

      const filePath = resolve(state.workingDir, args.trim());
      const result = await parsePipeline(filePath);
      if (!result.ok) {
        return { output: `  Error loading pipeline: ${result.error.message}` };
      }

      return {
        output: `  Loaded pipeline: ${result.value.name} v${result.value.version}`,
        stateUpdates: {
          pipelineConfig: result.value,
          pipelinePath: filePath,
        },
      };
    },
  },
  {
    name: "provider",
    aliases: [],
    description: "List configured providers",
    usage: "[list|test <name>]",
    async execute(args, state) {
      if (!state.pipelineConfig) {
        return { output: "  No pipeline loaded. Use /pipeline <path> first." };
      }

      const subcommand = args.trim().split(/\s+/)[0] ?? "list";

      if (subcommand === "list" || !subcommand) {
        const lines = Object.entries(state.pipelineConfig.providers).map(([name, cfg]) => {
          const key = cfg.api_key ? " (key configured)" : "";
          return `    ${name}: ${cfg.type} @ ${cfg.base_url}${key}`;
        });
        return { output: `  Providers:\n${lines.join("\n")}` };
      }

      if (subcommand === "test") {
        return { output: "  Provider testing is not yet implemented in REPL mode." };
      }

      return { output: `  Unknown subcommand: ${subcommand}. Use /provider list` };
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
