import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
/**
 * Interactive REPL shell for OpenMind.
 * Opens when you run `openmind` — like Claude Code or Codex.
 */
import * as readline from "node:readline";
import { checkFirstRun, listProviders } from "../../config";
import { createContextStore } from "../../context/store";
import { createEventBus } from "../../core/events/event-bus";
import { executePipeline, resolveExecutionOrder } from "../../pipeline/executor";
import { parsePipeline } from "../../pipeline/parser";
import { createPolicyEngine } from "../../policies/engine";
import { createProviderFromConfig } from "../../providers";
import type { LLMProvider } from "../../shared/types";
import {
  ensureGlobalWorkspace,
  getActivePipelineName,
  getProjectDir,
  hasProjectWorkspace,
  initProjectWorkspace,
  listAvailablePipelines,
  purgeOldHistory,
  readProjectSoul,
  resolvePipelinePath,
  setActivePipeline,
  writeHistoryEntry,
} from "../../workspace";
import { attachSlashCompletion, type KeypressEvent } from "./slash-completion";
import { type ReplState, executeSlashCommand, getCommandCompletions, getCompletionEntries } from "./slash-commands";

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

const getSeparator = () => c("dim", "─".repeat(process.stdout.columns || 80));

function printBanner(state: ReplState, globalProviderCount = 0, hasWorkspace = false): void {
  console.log();
  console.log(`  ${c("bold", c("cyan", `OpenMind v${VERSION}`))}`);
  console.log(`  ${c("dim", "AI Pipeline Orchestrator")}`);
  console.log();

  if (globalProviderCount > 0) {
    console.log(
      `  ${c("green", "●")} ${globalProviderCount} provider${globalProviderCount !== 1 ? "s" : ""} configured ${c("dim", "(~/.openmind)")}`,
    );
  } else {
    console.log(
      `  ${c("yellow", "○")} No providers configured ${c("dim", "— run /providers setup")}`,
    );
  }

  if (hasWorkspace) {
    const soul = readProjectSoul(state.workingDir);
    const soulStatus = soul ? c("green", "●") : c("dim", "○");
    console.log(`  ${soulStatus} Project workspace ${c("dim", "(.openmind/)")}`);
  }

  if (state.pipelineConfig) {
    const cfg = state.pipelineConfig;
    const stages = Object.keys(cfg.stages).length;
    const pipelineProviders = Object.keys(cfg.providers).length;
    console.log(`  ${c("green", "●")} Pipeline: ${c("bold", cfg.name)} v${cfg.version}`);
    console.log(
      `    ${stages} stage${stages !== 1 ? "s" : ""}, ${pipelineProviders} provider${pipelineProviders !== 1 ? "s" : ""}`,
    );
  } else {
    console.log(`  ${c("yellow", "○")} No pipeline loaded`);
    console.log(
      `    Run ${c("dim", "/pipeline add <path>")} to register one, or ${c("dim", "/help")} for commands`,
    );
  }
  console.log();
}

/**
 * Resolve which pipeline to load on startup.
 *
 * Resolution order:
 * 1. active-pipeline file → load that pipeline by name
 * 2. Single pipeline available → use it and set as active
 * 3. Multiple pipelines → don't auto-pick, let user choose
 * 4. Fallback: auto-detect *.pipeline.yaml in working directory (backward compat)
 * 5. Nothing found → no pipeline loaded
 */
async function resolvePipelineOnStartup(workingDir: string): Promise<Partial<ReplState>> {
  // 1. Check active-pipeline pointer
  const activeName = getActivePipelineName(workingDir);
  if (activeName) {
    const resolved = resolvePipelinePath(workingDir, activeName);
    if (resolved && !("conflict" in resolved)) {
      const result = await parsePipeline(resolved.path);
      if (result.ok) {
        return { pipelineConfig: result.value, pipelinePath: resolved.path };
      }
    }
    // If conflict or parse error, fall through
  }

  // 2. Check available pipelines in registry
  const available = listAvailablePipelines(workingDir);
  const uniqueNames = [...new Set(available.map((p) => p.name))];

  if (uniqueNames.length === 1 && available.length === 1) {
    // Single pipeline — use it and set as active
    const entry = available[0]!;
    const result = await parsePipeline(entry.path);
    if (result.ok) {
      setActivePipeline(workingDir, entry.name);
      return { pipelineConfig: result.value, pipelinePath: entry.path };
    }
  }

  if (available.length > 1) {
    // Multiple pipelines — show hint, let user choose
    console.log(`  ${c("dim", `${available.length} pipelines available — use /pipeline list to choose`)}`);
    return {};
  }

  // 3. Fallback: auto-detect YAML in working directory (backward compat)
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
        return { pipelineConfig: result.value, pipelinePath: filePath };
      }
    }
  }

  return {};
}

/**
 * Execute a natural language prompt through the loaded pipeline.
 */
async function executePipelinePrompt(
  input: string,
  state: ReplState,
  abortController?: AbortController,
): Promise<void> {
  if (!state.pipelineConfig) {
    console.log(
      `\n  ${c("yellow", "No pipeline loaded.")} Use ${c("dim", "/pipeline add <path>")} to register one.\n`,
    );
    return;
  }

  const config = state.pipelineConfig;

  // Show execution plan
  console.log();
  console.log(`  ${c("dim", "Pipeline:")} ${config.name} ${c("dim", `(${config.mode})`)}`);

  if (config.mode === "orchestrated") {
    const orchestrator = Object.entries(config.stages).find(([, s]) => s.role === "orchestrator");
    const agents = Object.entries(config.stages).filter(([, s]) => s.role !== "orchestrator");
    if (orchestrator) {
      console.log(`  ${c("dim", "  Orchestrator:")} ${orchestrator[0]}`);
      console.log(`  ${c("dim", "  Agents:")} ${agents.map(([n]) => n).join(", ")}`);
    }
  } else {
    const orderResult = resolveExecutionOrder(config.stages);
    if (!orderResult.ok) {
      console.log(`\n  ${c("red", "DAG error:")} ${orderResult.error.message}\n`);
      return;
    }
    const layers = orderResult.value;
    for (const [i, layer] of layers.entries()) {
      const parallel = layer.length > 1 ? c("dim", " (parallel)") : "";
      console.log(`  ${c("dim", `  Layer ${i + 1}${parallel}:`)} ${layer.join(", ")}`);
    }
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

  // Create context store (disk-backed if workspace exists, else in-memory) and event bus
  const dbPath = hasProjectWorkspace(state.workingDir)
    ? join(getProjectDir(state.workingDir), "context.db")
    : ":memory:";
  const contextStore = createContextStore({ dbPath });
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
  eventBus.on("stage:warning", (e) => {
    if (e.type === "stage:warning") {
      console.log(`    ${c("yellow", "⚠")} ${c("yellow", e.message)}`);
    }
  });
  eventBus.on("stage:complete", (e) => {
    if (e.type === "stage:complete") {
      const { stageName, status, durationMs, usage, stopReason, workSummary } = e.result;
      const icon = status === "success" ? c("green", "✓") : c("red", "✗");
      const tokens = usage ? `${usage.totalTokens} tokens` : "";

      // Show stop reason if noteworthy
      let reasonText = "";
      if (stopReason === "token_limit") {
        reasonText = c("yellow", " [stopped: token limit]");
      } else if (stopReason === "max_iterations") {
        reasonText = c("yellow", " [stopped: max iterations]");
      }

      // Show work summary
      let summaryText = "";
      if (workSummary) {
        const parts: string[] = [];
        if (workSummary.filesWritten.length > 0) {
          parts.push(`${workSummary.filesWritten.length} files`);
        }
        if (workSummary.commandsRun.length > 0) {
          parts.push(`${workSummary.commandsRun.length} commands`);
        }
        if (parts.length > 0) {
          summaryText = c("dim", ` (${parts.join(", ")})`);
        }
      }

      console.log(`  ${icon} ${stageName} ${c("dim", `${durationMs}ms ${tokens}`)}${summaryText}${reasonText}`);
    }
  });
  eventBus.on("stage:error", (e) => {
    if (e.type === "stage:error") {
      console.log(`  ${c("red", "✗")} ${e.stageName}: ${e.error}`);
    }
  });
  eventBus.on("stage:model-fallback", (e) => {
    if (e.type === "stage:model-fallback") {
      console.log(
        `  ${c("yellow", "⇄")} ${e.stageName}: falling back from ${c("dim", e.fromModel)} → ${c("bold", e.toModel)}`,
      );
    }
  });
  eventBus.on("delegate:start", (e) => {
    if (e.type === "delegate:start") {
      const taskPreview = e.task.length > 80 ? `${e.task.slice(0, 80)}…` : e.task;
      console.log(`    ${c("cyan", "▸")} ${c("bold", e.agentName)} ${c("dim", `(${e.model})`)}`);
      console.log(`      ${c("dim", taskPreview)}`);
    }
  });
  eventBus.on("delegate:complete", (e) => {
    if (e.type === "delegate:complete") {
      const tokens = e.result.usage ? `${e.result.usage.totalTokens} tokens` : "";
      console.log(`    ${c("green", "◂")} ${e.agentName} ${c("dim", `${e.durationMs}ms ${tokens}`)}`);
    }
  });
  eventBus.on("delegate:error", (e) => {
    if (e.type === "delegate:error") {
      console.log(`    ${c("red", "◂")} ${e.agentName}: ${c("red", e.error)}`);
    }
  });

  // Token limit callback: ask the user if they want to continue
  async function onTokenLimit(
    stgName: string,
    summary: { filesWritten: string[]; commandsRun: string[] },
  ): Promise<boolean> {
    console.log();
    console.log(`  ${c("yellow", "⚠")} ${c("bold", stgName)} hit the output token limit.`);
    if (summary.filesWritten.length > 0) {
      console.log(`    Files written so far: ${c("dim", summary.filesWritten.join(", "))}`);
    }

    return new Promise<boolean>((resolve) => {
      process.stdout.write(`  ${c("cyan", "Continue execution?")} ${c("dim", "(y/n) ")}`);
      const onData = (data: Buffer) => {
        const key = data.toString().trim().toLowerCase();
        if (key === "y" || key === "yes" || key === "") {
          process.stdin.removeListener("data", onData);
          process.stdin.setRawMode?.(false);
          console.log();
          resolve(true);
        } else if (key === "n" || key === "no") {
          process.stdin.removeListener("data", onData);
          process.stdin.setRawMode?.(false);
          console.log();
          resolve(false);
        }
      };
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on("data", onData);
    });
  }

  // Execute pipeline
  const result = await executePipeline({
    config,
    providers,
    contextStore,
    policyEngine: policyResult.value,
    eventBus,
    workingDir: state.workingDir,
    skillsDir,
    signal: abortController?.signal,
    onTokenLimit,
  });

  contextStore.close();

  // Write execution history if workspace exists
  if (result.ok && hasProjectWorkspace(state.workingDir)) {
    const run = result.value;
    const stageSummaries = run.stages
      .map((s) => {
        const status = s.status === "success" ? "OK" : s.status;
        const files = s.workSummary?.filesWritten.length ?? 0;
        return `- **${s.stageName}**: ${status}${files > 0 ? ` (${files} files)` : ""}`;
      })
      .join("\n");

    const historyContent =
      `# Pipeline: ${run.pipelineName}\n` +
      `**Status**: ${run.status}\n` +
      `**Duration**: ${run.totalDurationMs}ms\n` +
      `**Tokens**: ${run.totalTokens.totalTokens}\n` +
      `**Prompt**: ${input.slice(0, 200)}${input.length > 200 ? "..." : ""}\n\n` +
      `## Stages\n${stageSummaries}\n`;

    writeHistoryEntry(state.workingDir, historyContent);
  }

  if (!result.ok) {
    if (abortController?.signal.aborted) {
      console.log(`\n  ${c("yellow", "Pipeline cancelled by user.")}\n`);
    } else {
      console.log(`\n  ${c("red", "Pipeline failed:")} ${result.error.message}\n`);
    }
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

  // First-run: ensure global ~/.openmind/ exists
  ensureGlobalWorkspace();
  await checkFirstRun();

  // Resolve which pipeline to load
  const detected = await resolvePipelineOnStartup(cwd);
  Object.assign(state, detected);

  if (state.pipelineConfig && !hasProjectWorkspace(cwd)) {
    initProjectWorkspace(cwd);
  }

  // Purge old history entries (>30 days)
  if (hasProjectWorkspace(cwd)) {
    purgeOldHistory(cwd);
  }

  // Show configured providers count in banner
  const globalProviders = listProviders();
  printBanner(state, globalProviders.length, hasProjectWorkspace(cwd));

  const completions = getCommandCompletions();
  const completionEntries = getCompletionEntries();

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

  // Attach interactive slash completion (renders filtered menu as you type)
  const slashCompletion = attachSlashCompletion(rl, completionEntries);

  // Intercept keypresses before readline processes them.
  // Wrap _ttyWrite so we can consume keys (Tab, arrows) when the menu is active.
  const rlAny = rl as unknown as {
    _ttyWrite: (s: string | undefined, key: KeypressEvent) => void;
  };
  const originalTtyWrite = rlAny._ttyWrite.bind(rl);
  rlAny._ttyWrite = (s: string | undefined, key: KeypressEvent) => {
    const consumed = slashCompletion.handleKeypress(s, key);
    if (!consumed) {
      originalTtyWrite(s, key);
    }
  };

  console.log(getSeparator());
  rl.prompt();

  // Cancellation: active controller is set during pipeline execution
  let activeAbortController: AbortController | null = null;

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
        activeAbortController = new AbortController();
        await executePipelinePrompt(trimmed, state, activeAbortController);
        activeAbortController = null;
      }

      console.log(getSeparator());
      rl.prompt();
    }

    processing = false;
  }

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed) {
      console.log(getSeparator());
    }
    lineQueue.push(line);
    processQueue();
  });

  rl.on("close", async () => {
    slashCompletion.destroy();
    // Wait for any pending commands to finish
    while (processing) {
      await new Promise((r) => setTimeout(r, 10));
    }
    console.log();
    process.exit(0);
  });

  // Handle Ctrl+C: cancel running pipeline or show hint
  rl.on("SIGINT", () => {
    if (activeAbortController) {
      activeAbortController.abort();
      console.log(`\n  ${c("yellow", "⚠")} ${c("bold", "Cancelling pipeline...")} ${c("dim", "waiting for current operation to finish")}`);
    } else {
      console.log(`\n  ${c("dim", "Use /exit or Ctrl+D to quit.")}`);
      console.log(getSeparator());
      rl.prompt();
    }
  });
}
