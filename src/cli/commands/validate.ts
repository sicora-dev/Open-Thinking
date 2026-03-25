/**
 * `openthk validate` — Validate a pipeline YAML file.
 */
import type { Command } from "commander";
import { parsePipeline } from "../../pipeline/parser";

export function registerValidateCommand(program: Command): void {
  program
    .command("validate")
    .description("Validate pipeline YAML configuration")
    .option("-f, --file <path>", "Pipeline file path", "openthk.pipeline.yaml")
    .action(async (options: { file: string }) => {
      console.log(`Validating: ${options.file}\n`);

      // Parse without env interpolation for validation-only
      const result = await parsePipeline(options.file, false);

      if (!result.ok) {
        console.error(`Validation failed: ${result.error.message}`);
        if (result.error.details) {
          console.error("  Details:", JSON.stringify(result.error.details, null, 2));
        }
        process.exit(1);
      }

      const config = result.value;
      const stageNames = Object.keys(config.stages);
      const providerNames = Object.keys(config.providers);

      console.log(`Pipeline: ${config.name} v${config.version}`);
      console.log(`Providers: ${providerNames.join(", ")}`);
      console.log(`Stages: ${stageNames.join(" -> ")}`);
      console.log(`Context backend: ${config.context.backend}`);
      console.log("\nValidation passed.");
    });
}
