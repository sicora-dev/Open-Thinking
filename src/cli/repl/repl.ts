import { basename, dirname, join, resolve } from "node:path";
/**
 * Interactive REPL shell for OpenThinking.
 * Opens when you run `openthk` — like Claude Code or Codex.
 */
import * as readline from "node:readline";
import { checkFirstRun, listProviders } from "../../config";
import { createContextStore } from "../../context/store";
import { createEventBus } from "../../core/events/event-bus";
import { createPermissionEngine } from "../../core/permissions";
import type { PermissionMode } from "../../core/permissions";
import { executePipeline, resolveExecutionOrder } from "../../pipeline/executor";
import { createPolicyEngine } from "../../policies/engine";
import { createProviderFromConfig } from "../../providers";
import { createPersistedRunTracker } from "../../runs/persistence";
import { getProjectSkillsDir } from "../../skills/catalog";
import type { LLMProvider } from "../../shared/types";
import { maybeAutostartUi } from "../../ui/autostart";
import { VERSION } from "../../version";
import {
  ensureGlobalWorkspace,
  getProjectDir,
  hasProjectWorkspace,
  listAvailablePipelines,
  readProjectSoul,
  writeHistoryEntry,
} from "../../workspace";
import {
  type ReplState,
  executeSlashCommand,
  getCommandCompletions,
  getCompletionEntries,
} from "./slash-commands";
import { type KeypressEvent, attachSlashCompletion } from "./slash-completion";
import { createTokenMeter } from "./token-meter";
import { loadWorkspaceSessionState } from "./workspace-session";

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
  console.log(`  ${c("bold", c("cyan", `OpenThinking v${VERSION}`))}`);
  console.log(`  ${c("dim", "AI Pipeline Orchestrator")}`);
  console.log();

  if (globalProviderCount > 0) {
    console.log(
      `  ${c("green", "●")} ${globalProviderCount} provider${globalProviderCount !== 1 ? "s" : ""} configured ${c("dim", "(~/.openthk)")}`,
    );
  } else {
    console.log(
      `  ${c("yellow", "○")} No providers configured ${c("dim", "— run /providers setup")}`,
    );
  }

  if (hasWorkspace) {
    const soul = readProjectSoul(state.workingDir);
    const soulStatus = soul ? c("green", "●") : c("dim", "○");
    console.log(`  ${soulStatus} Project workspace ${c("dim", "(.openthk/)")}`);
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

  // Create permission engine (resolve mode: CLI flag > pipeline YAML > default "confirm")
  const permissionMode: PermissionMode = (config.permissions as PermissionMode) ?? "confirm";
  const permissionEngine = createPermissionEngine({
    mode: permissionMode,
    workingDir: state.workingDir,
    eventBus,
  });

  // Wire interactive confirmation prompts for permission requests
  eventBus.on("permission:request", (e) => {
    if (e.type !== "permission:request") return;
    const { request } = e;
    const riskColor = request.risk === "dangerous" ? COLORS.red : request.risk === "moderate" ? COLORS.yellow : COLORS.green;
    console.log();
    console.log(`  ${riskColor}[${request.risk}]${COLORS.reset} ${request.description}`);
    console.log(`  ${c("dim", "(y)es / (n)o / (a)llow always / (d)eny always")}`);

    // Read a single key from stdin for the confirmation
    const onData = (data: Buffer) => {
      const key = data.toString().trim().toLowerCase();
      let action: "allow" | "deny" = "allow";
      let remember = false;

      if (key === "y" || key === "yes" || key === "") {
        action = "allow";
      } else if (key === "n" || key === "no") {
        action = "deny";
      } else if (key === "a") {
        action = "allow";
        remember = true;
      } else if (key === "d") {
        action = "deny";
        remember = true;
      } else {
        return; // Ignore unrecognized keys, wait for valid input
      }

      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode?.(false);
      permissionEngine.confirmations().resolve(request.id, { action, remember });
    };

    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });

  const meter = createTokenMeter({ eventBus });
  const tracker = createPersistedRunTracker({
    eventBus,
    pipelineName: config.name,
    pipelinePath: state.pipelinePath,
    prompt: input,
  });

  // Seed user input
  await contextStore.set("input.prompt", input, "user");

  // Resolve skills directory
  const pipelineDir = state.pipelinePath ? dirname(resolve(state.pipelinePath)) : state.workingDir;
  const skillsDir =
    state.skillsDir ??
    (basename(pipelineDir) === "pipelines" && basename(dirname(pipelineDir)) === ".openthk"
      ? resolve(pipelineDir, "skills")
      : hasProjectWorkspace(state.workingDir)
        ? getProjectSkillsDir(state.workingDir)
        : resolve(pipelineDir, "skills"));

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

      console.log(
        `  ${icon} ${stageName} ${c("dim", `${durationMs}ms ${tokens}`)}${summaryText}${reasonText}`,
      );
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
      console.log(
        `    ${c("green", "◂")} ${e.agentName} ${c("dim", `${e.durationMs}ms ${tokens}`)}`,
      );
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

  // Start the live token meter. While active, route console.log through
  // its quiet-zone so event-handler output never collides with the spinner
  // line. We restore the original console.log in `finally` below.
  const originalLog = console.log;
  meter.start();
  console.log = (...args: unknown[]) => {
    meter.withQuietZone(() => originalLog(...args));
  };

  // Execute pipeline
  let result: Awaited<ReturnType<typeof executePipeline>>;
  try {
    result = await executePipeline({
      config,
      providers,
      contextStore,
      policyEngine: policyResult.value,
      eventBus,
      workingDir: state.workingDir,
      skillsDir,
      signal: abortController?.signal,
      onTokenLimit,
      permissionEngine,
    });
  } finally {
    meter.stop();
    console.log = originalLog;
  }

  // Stash the run summary on state for /tokens to inspect later.
  state.lastRun = {
    totals: meter.totals(),
    stages: result.ok ? result.value.stages : [],
  };

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
    tracker.finishWithError(result.error.message, abortController?.signal.aborted ?? false);
    if (abortController?.signal.aborted) {
      console.log(`\n  ${c("yellow", "Pipeline cancelled by user.")}\n`);
    } else {
      console.log(`\n  ${c("red", "Pipeline failed:")} ${result.error.message}\n`);
    }
    return;
  }

  const run = result.value;
  tracker.finishFromResult(run, abortController?.signal.aborted ?? false);
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

  // First-run: ensure global ~/.openthk/ exists
  ensureGlobalWorkspace();
  await checkFirstRun();
  await maybeAutostartUi();

  // Resolve which pipeline to load
  const detected = await loadWorkspaceSessionState(cwd);
  Object.assign(state, detected);

  const available = listAvailablePipelines(state.workingDir);
  if (!state.pipelineConfig && available.length > 1) {
    console.log(
      `  ${c("dim", `${available.length} pipelines available — use /pipeline list to choose`)}`,
    );
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
      console.log(
        `\n  ${c("yellow", "⚠")} ${c("bold", "Cancelling pipeline...")} ${c("dim", "waiting for current operation to finish")}`,
      );
    } else {
      console.log(`\n  ${c("dim", "Use /exit or Ctrl+D to quit.")}`);
      console.log(getSeparator());
      rl.prompt();
    }
  });
}
