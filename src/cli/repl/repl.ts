import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
/**
 * Interactive REPL shell for OpenMind.
 * Opens when you run `openmind` — like Claude Code or Codex.
 */
import * as readline from "node:readline";
import { createContextStore } from "../../context/store";
import { createEventBus } from "../../core/events/event-bus";
import { executePipeline, resolveExecutionOrder } from "../../pipeline/executor";
import { parsePipeline } from "../../pipeline/parser";
import { createPolicyEngine } from "../../policies/engine";
import { createProviderFromConfig } from "../../providers";
import type { LLMProvider } from "../../shared/types";
import { type ReplState, executeSlashCommand, getCommandCompletions } from "./slash-commands";

const VERSION = "0.1.0";

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function c(color: keyof typeof COLORS, text: string): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function printBanner(state: ReplState): void {
  console.log();
  console.log(`  ${c("bold", c("cyan", `OpenMind v${VERSION}`))}`);
  console.log(`  ${c("dim", "AI Pipeline Orchestrator")}`);
  console.log();

  if (state.pipelineConfig) {
    const cfg = state.pipelineConfig;
    const stages = Object.keys(cfg.stages).length;
    const providers = Object.keys(cfg.providers).length;
    console.log(`  ${c("green", "●")} Pipeline: ${c("bold", cfg.name)} v${cfg.version}`);
    console.log(
      `    ${stages} stage${stages !== 1 ? "s" : ""}, ${providers} provider${providers !== 1 ? "s" : ""}`,
    );
  } else {
    console.log(`  ${c("yellow", "○")} No pipeline loaded`);
    console.log(
      `    Run ${c("dim", "/pipeline <path>")} to load one, or ${c("dim", "/help")} for commands`,
    );
  }
  console.log();
}

/**
 * Auto-detect pipeline YAML in the working directory.
 */
async function autoDetectPipeline(workingDir: string): Promise<Partial<ReplState>> {
  const candidates = [
    "openmind.pipeline.yaml",
    "openmind.pipeline.yml",
    "pipeline.yaml",
    "pipeline.yml",
  ];

  for (const candidate of candidates) {
    const filePath = resolve(workingDir, candidate);
    if (existsSync(filePath)) {
      const result = await parsePipeline(filePath);
      if (result.ok) {
        return {
          pipelineConfig: result.value,
          pipelinePath: filePath,
        };
      }
    }
  }

  return {};
}

/**
 * Execute a natural language prompt through the loaded pipeline.
 */
async function executePipelinePrompt(input: string, state: ReplState): Promise<void> {
  if (!state.pipelineConfig) {
    console.log(
      `\n  ${c("yellow", "No pipeline loaded.")} Use ${c("dim", "/pipeline <path>")} to load one.\n`,
    );
    return;
  }

  const config = state.pipelineConfig;

  // Resolve execution order
  const orderResult = resolveExecutionOrder(config.stages);
  if (!orderResult.ok) {
    console.log(`\n  ${c("red", "DAG error:")} ${orderResult.error.message}\n`);
    return;
  }

  const layers = orderResult.value;

  // Show execution plan
  console.log();
  console.log(`  ${c("dim", "Pipeline:")} ${config.name}`);
  for (const [i, layer] of layers.entries()) {
    const parallel = layer.length > 1 ? c("dim", " (parallel)") : "";
    console.log(`  ${c("dim", `  Layer ${i + 1}${parallel}:`)} ${layer.join(", ")}`);
  }
  console.log();

  // Create providers
  const providers: Record<string, LLMProvider> = {};
  for (const [name, providerConfig] of Object.entries(config.providers)) {
    const result = createProviderFromConfig(name, providerConfig);
    if (!result.ok) {
      console.log(`  ${c("red", `Provider "${name}" error:`)} ${result.error.message}\n`);
      return;
    }
    providers[name] = result.value;
  }

  // Create policy engine
  const policyResult = createPolicyEngine(config.policies.global);
  if (!policyResult.ok) {
    console.log(`  ${c("red", "Policy error:")} ${policyResult.error.message}\n`);
    return;
  }

  // Create context store and event bus
  const contextStore = createContextStore({ dbPath: ":memory:" });
  const eventBus = createEventBus();

  // Seed user input
  await contextStore.set("input.prompt", input, "user");

  // Resolve skills directory
  const pipelineDir = state.pipelinePath ? dirname(resolve(state.pipelinePath)) : state.workingDir;
  const skillsDir = state.skillsDir ?? resolve(pipelineDir, "skills");

  // Wire up live events
  eventBus.on("stage:start", (e) => {
    if (e.type === "stage:start") {
      console.log(`  ${c("cyan", "▶")} ${c("bold", e.stageName)} ${c("dim", `(${e.model})`)}`);
    }
  });
  eventBus.on("tool:call", (e) => {
    if (e.type === "tool:call") {
      const argSummary = Object.entries(e.args)
        .map(([k, v]) => {
          const s = String(v);
          return `${k}=${s.length > 50 ? `${s.slice(0, 50)}…` : s}`;
        })
        .join(", ");
      console.log(`    ${c("dim", "→")} ${c("magenta", e.toolName)}${c("dim", `(${argSummary})`)}`);
    }
  });
  eventBus.on("tool:result", (e) => {
    if (e.type === "tool:result") {
      const icon = e.success ? c("green", "✓") : c("red", "✗");
      console.log(`    ${c("dim", "←")} ${icon} ${c("dim", `${e.durationMs}ms`)}`);
    }
  });
  eventBus.on("stage:complete", (e) => {
    if (e.type === "stage:complete") {
      const { stageName, status, durationMs, usage } = e.result;
      const icon = status === "success" ? c("green", "✓") : c("red", "✗");
      const tokens = usage ? `${usage.totalTokens} tokens` : "";
      console.log(`  ${icon} ${stageName} ${c("dim", `${durationMs}ms ${tokens}`)}`);
    }
  });
  eventBus.on("stage:error", (e) => {
    if (e.type === "stage:error") {
      console.log(`  ${c("red", "✗")} ${e.stageName}: ${e.error}`);
    }
  });

  // Execute pipeline
  const result = await executePipeline({
    config,
    providers,
    contextStore,
    policyEngine: policyResult.value,
    eventBus,
    skillsDir,
  });

  contextStore.close();

  if (!result.ok) {
    console.log(`\n  ${c("red", "Pipeline failed:")} ${result.error.message}\n`);
    return;
  }

  const run = result.value;
  console.log();

  // Show results
  for (const stage of run.stages) {
    if (stage.output) {
      console.log(`  ${c("bold", `[${stage.stageName}]`)}`);
      // Indent output
      const lines = stage.output.split("\n");
      const preview = lines.length > 50 ? lines.slice(0, 50) : lines;
      for (const line of preview) {
        console.log(`  ${line}`);
      }
      if (lines.length > 50) {
        console.log(`  ${c("dim", `... ${lines.length - 50} more lines`)}`);
      }
      console.log();
    }
  }

  // Summary
  const statusColor =
    run.status === "success" ? "green" : run.status === "partial" ? "yellow" : "red";
  console.log(
    `  ${c(statusColor, run.status)} ${c("dim", `${run.totalDurationMs}ms | ${run.totalTokens.totalTokens} tokens | $${run.totalCost.toFixed(4)}`)}\n`,
  );
}

/**
 * Start the interactive REPL.
 */
export async function startRepl(workingDir?: string): Promise<void> {
  const cwd = workingDir ?? process.cwd();

  const state: ReplState = {
    pipelineConfig: null,
    pipelinePath: null,
    workingDir: cwd,
    skillsDir: null,
  };

  // Auto-detect pipeline
  const detected = await autoDetectPipeline(cwd);
  Object.assign(state, detected);

  printBanner(state);

  const completions = getCommandCompletions();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${COLORS.cyan}❯${COLORS.reset} `,
    completer: (line: string) => {
      if (line.startsWith("/")) {
        const hits = completions.filter((c) => c.startsWith(line));
        return [hits.length ? hits : completions, line];
      }
      return [[], line];
    },
    historySize: 200,
  });

  rl.prompt();

  // Queue lines to handle async commands sequentially
  const lineQueue: string[] = [];
  let processing = false;

  async function processQueue(): Promise<void> {
    if (processing) return;
    processing = true;

    while (lineQueue.length > 0) {
      const line = lineQueue.shift() as string;
      const trimmed = line.trim();

      if (!trimmed) {
        rl.prompt();
        continue;
      }

      if (trimmed.startsWith("/")) {
        const result = await executeSlashCommand(trimmed.slice(1), state);

        if (result.output) {
          console.log(result.output);
        }

        if (result.stateUpdates) {
          Object.assign(state, result.stateUpdates);
        }

        if (result.exit) {
          rl.close();
          processing = false;
          return;
        }
      } else {
        await executePipelinePrompt(trimmed, state);
      }

      rl.prompt();
    }

    processing = false;
  }

  rl.on("line", (line) => {
    lineQueue.push(line);
    processQueue();
  });

  rl.on("close", async () => {
    // Wait for any pending commands to finish
    while (processing) {
      await new Promise((r) => setTimeout(r, 10));
    }
    console.log();
    process.exit(0);
  });

  // Handle Ctrl+C gracefully
  rl.on("SIGINT", () => {
    console.log(`\n  ${c("dim", "Use /exit or Ctrl+D to quit.")}`);
    rl.prompt();
  });
}
