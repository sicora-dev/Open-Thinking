/**
 * `openmind run` — Execute a pipeline.
 */
import { dirname, resolve } from "node:path";
import type { Command } from "commander";
import { createContextStore } from "../../context/store";
import { createEventBus } from "../../core/events/event-bus";
import { executePipeline, resolveExecutionOrder } from "../../pipeline/executor";
import { parsePipeline } from "../../pipeline/parser";
import { createPolicyEngine } from "../../policies/engine";
import { createProviderFromConfig } from "../../providers";
import type { LLMProvider } from "../../shared/types";

type RunOptions = {
  pipeline: string;
  input?: string;
  stage?: string;
  dryRun?: boolean;
  skillsDir?: string;
};

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Execute a pipeline")
    .requiredOption("-p, --pipeline <path>", "Pipeline YAML file path")
    .option("-i, --input <text>", "Input prompt describing what the pipeline should do")
    .option("-s, --stage <name>", "Execute a single stage only")
    .option("--skills-dir <path>", "Skills directory (default: skills/ next to pipeline file)")
    .option("--dry-run", "Show execution plan without running")
    .action(async (options: RunOptions) => {
      if (!options.input) {
        console.error("Error: --input is required. Tell the pipeline what to do.");
        console.error(
          '  Example: openmind run -p pipeline.yaml -i "Build a REST API for a todo app"',
        );
        process.exit(1);
      }

      // Parse pipeline
      const parseResult = await parsePipeline(options.pipeline);
      if (!parseResult.ok) {
        console.error(`Parse error: ${parseResult.error.message}`);
        process.exit(1);
      }

      const config = parseResult.value;
      console.log(`Pipeline: ${config.name} v${config.version}`);
      console.log(`Input: ${options.input}\n`);

      // Resolve execution order
      const orderResult = resolveExecutionOrder(config.stages);
      if (!orderResult.ok) {
        console.error(`DAG error: ${orderResult.error.message}`);
        process.exit(1);
      }

      const layers = orderResult.value;
      console.log("Execution plan:");
      for (const [i, layer] of layers.entries()) {
        const parallel = layer.length > 1 ? " (parallel)" : "";
        console.log(`  Layer ${i + 1}${parallel}: ${layer.join(", ")}`);
      }
      console.log();

      if (options.dryRun) {
        console.log("[DRY RUN] Execution plan shown above. No stages were executed.");
        return;
      }

      // Create providers
      const providers: Record<string, LLMProvider> = {};
      for (const [name, providerConfig] of Object.entries(config.providers)) {
        const result = createProviderFromConfig(name, providerConfig);
        if (!result.ok) {
          console.error(`Provider "${name}" error: ${result.error.message}`);
          process.exit(1);
        }
        providers[name] = result.value;
      }

      // Create policy engine
      const policyResult = createPolicyEngine(config.policies.global);
      if (!policyResult.ok) {
        console.error(`Policy error: ${policyResult.error.message}`);
        process.exit(1);
      }

      // Create context store and event bus
      const contextStore = createContextStore({ dbPath: ":memory:" });
      const eventBus = createEventBus();

      // Seed user input into context store
      await contextStore.set("input.prompt", options.input, "user");

      // Resolve skills directory
      const pipelineDir = dirname(resolve(options.pipeline));
      const skillsDir = options.skillsDir ?? resolve(pipelineDir, "skills");

      // Wire up live event output
      eventBus.on("stage:start", (e) => {
        if (e.type === "stage:start") {
          console.log(`[${e.stageName}] Starting (model: ${e.model})...`);
        }
      });
      eventBus.on("stage:complete", (e) => {
        if (e.type === "stage:complete") {
          const { stageName, status, durationMs, usage } = e.result;
          const tokens = usage ? ` | ${usage.totalTokens} tokens` : "";
          console.log(`[${stageName}] ${status} (${durationMs}ms${tokens})`);
        }
      });
      eventBus.on("stage:error", (e) => {
        if (e.type === "stage:error") {
          console.error(`[${e.stageName}] Error: ${e.error}`);
        }
      });
      eventBus.on("tool:call", (e) => {
        if (e.type === "tool:call") {
          const argSummary = Object.entries(e.args)
            .map(([k, v]) => {
              const s = String(v);
              return `${k}=${s.length > 40 ? `${s.slice(0, 40)}...` : s}`;
            })
            .join(", ");
          console.log(`  [${e.stageName}] -> ${e.toolName}(${argSummary})`);
        }
      });
      eventBus.on("tool:result", (e) => {
        if (e.type === "tool:result") {
          const status = e.success ? "ok" : "error";
          console.log(`  [${e.stageName}] <- ${e.toolName} ${status} (${e.durationMs}ms)`);
        }
      });

      // Execute
      const result = await executePipeline({
        config,
        providers,
        contextStore,
        policyEngine: policyResult.value,
        eventBus,
        workingDir: process.cwd(),
        skillsDir,
      });

      contextStore.close();

      if (!result.ok) {
        console.error(`\nPipeline execution failed: ${result.error.message}`);
        process.exit(1);
      }

      const run = result.value;
      console.log("\n--- Results ---");
      console.log(`Status: ${run.status}`);
      console.log(`Duration: ${run.totalDurationMs}ms`);
      console.log(`Total tokens: ${run.totalTokens.totalTokens}`);
      console.log(`Estimated cost: $${run.totalCost.toFixed(4)}`);

      for (const stage of run.stages) {
        console.log(`\n[${stage.stageName}] ${stage.status}`);
        if (stage.output) {
          const preview =
            stage.output.length > 500 ? `${stage.output.slice(0, 500)}...` : stage.output;
          console.log(preview);
        }
        if (stage.error) {
          console.log(`  Error: ${stage.error}`);
        }
      }

      if (run.status === "failed") process.exit(1);
    });
}
