/**
 * `openmind run` — Execute a pipeline.
 */
import type { Command } from "commander";
import { createContextStore } from "../../context/store";
import { createEventBus } from "../../core/events/event-bus";
import { executePipeline, resolveExecutionOrder } from "../../pipeline/executor";
import { parsePipeline } from "../../pipeline/parser";
import { createPolicyEngine } from "../../policies/engine";
import { createProviderFromConfig } from "../../providers";
import type { LLMProvider } from "../../shared/types";

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Execute a pipeline")
    .requiredOption("-p, --pipeline <path>", "Pipeline YAML file path")
    .option("-s, --stage <name>", "Execute a single stage only")
    .option("--dry-run", "Show execution plan without running")
    .action(async (options: { pipeline: string; stage?: string; dryRun?: boolean }) => {
      // Parse pipeline
      const parseResult = await parsePipeline(options.pipeline);
      if (!parseResult.ok) {
        console.error(`Parse error: ${parseResult.error.message}`);
        process.exit(1);
      }

      const config = parseResult.value;
      console.log(`Pipeline: ${config.name} v${config.version}\n`);

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

      // Execute
      const result = await executePipeline({
        config,
        providers,
        contextStore,
        policyEngine: policyResult.value,
        eventBus,
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
            stage.output.length > 200 ? `${stage.output.slice(0, 200)}...` : stage.output;
          console.log(preview);
        }
        if (stage.error) {
          console.log(`  Error: ${stage.error}`);
        }
      }

      if (run.status === "failed") process.exit(1);
    });
}
