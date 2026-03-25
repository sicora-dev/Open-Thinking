/**
 * `openthk provider add|list|test` — Manage LLM providers.
 */
import type { Command } from "commander";
import { parsePipeline } from "../../pipeline/parser";
import { createProviderFromConfig } from "../../providers";

export function registerProviderCommand(program: Command): void {
  const provider = program.command("provider").description("Manage LLM providers");

  provider
    .command("list")
    .description("List providers from pipeline config")
    .option("-f, --file <path>", "Pipeline file path", "openthk.pipeline.yaml")
    .action(async (options: { file: string }) => {
      const result = await parsePipeline(options.file, false);
      if (!result.ok) {
        console.error(`Error: ${result.error.message}`);
        process.exit(1);
      }

      const providers = Object.entries(result.value.providers);
      if (providers.length === 0) {
        console.log("No providers configured.");
        return;
      }

      console.log("Configured providers:\n");
      for (const [name, config] of providers) {
        console.log(`  ${name}`);
        console.log(`    Type: ${config.type}`);
        console.log(`    URL:  ${config.base_url}`);
        console.log(`    Key:  ${config.api_key ? "***" : "(none)"}`);
        console.log();
      }
    });

  provider
    .command("test")
    .description("Test provider connection")
    .argument("<name>", "Provider name to test")
    .option("-f, --file <path>", "Pipeline file path", "openthk.pipeline.yaml")
    .action(async (name: string, options: { file: string }) => {
      const parseResult = await parsePipeline(options.file);
      if (!parseResult.ok) {
        console.error(`Error: ${parseResult.error.message}`);
        process.exit(1);
      }

      const providerConfig = parseResult.value.providers[name];
      if (!providerConfig) {
        console.error(`Provider "${name}" not found in ${options.file}`);
        process.exit(1);
      }

      const createResult = createProviderFromConfig(name, providerConfig);
      if (!createResult.ok) {
        console.error(`Failed to create provider: ${createResult.error.message}`);
        process.exit(1);
      }

      const provider = createResult.value;

      console.log(`Testing provider: ${name} (${providerConfig.type})`);
      console.log(`  URL: ${providerConfig.base_url}\n`);

      // Health check
      const healthResult = await provider.healthCheck();
      if (healthResult.ok && healthResult.value) {
        console.log("  Health check: OK");
      } else {
        console.log("  Health check: FAILED");
        process.exit(1);
      }

      // List models
      const modelsResult = await provider.listModels();
      if (modelsResult.ok) {
        console.log(`  Available models: ${modelsResult.value.length}`);
        for (const model of modelsResult.value.slice(0, 5)) {
          console.log(`    - ${model.id}`);
        }
        if (modelsResult.value.length > 5) {
          console.log(`    ... and ${modelsResult.value.length - 5} more`);
        }
      }

      console.log("\nProvider test passed.");
    });
}
