import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
/**
 * `openthk init [name]` — Scaffold a new OpenThinking project.
 */
import type { Command } from "commander";
import { ensureGlobalWorkspace, initProjectWorkspace, setActivePipeline } from "../../workspace";

const PIPELINE_TEMPLATE = `name: my-pipeline
version: "0.1.0"

context:
  backend: sqlite
  vector: embedded
  ttl: "7d"

# Providers are resolved automatically from the catalog.
# API keys come from ~/.openthk/providers.json (run: openthk, then /providers setup).
providers:
  - openai

stages:
  planner:
    provider: openai
    model: gpt-4o
    skill: core/arch-planner@1.0
    context:
      read: ["input.*"]
      write: ["plan.*"]

  coder:
    provider: openai
    model: gpt-4o
    skill: core/code-writer@1.0
    context:
      read: ["input.*", "plan.*"]
      write: ["code.*"]
    depends_on: [planner]

policies:
  global:
    audit_log: true
`;

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a new OpenThinking project")
    .argument("[name]", "Project name", ".")
    .action(async (name: string) => {
      const dir = resolve(name === "." ? process.cwd() : name);
      const pipelineFile = join(dir, "openthk.pipeline.yaml");
      const skillsDir = join(dir, "skills");

      // Initialize workspace directories first (creates .openthk/pipelines/)
      ensureGlobalWorkspace();

      if (name !== ".") {
        mkdirSync(dir, { recursive: true });
      }
      mkdirSync(skillsDir, { recursive: true });

      const isNew = initProjectWorkspace(dir);

      // Write pipeline into .openthk/pipelines/
      const pipelinesDest = join(dir, ".openthk", "pipelines", "default.yaml");
      if (existsSync(pipelinesDest)) {
        console.error(`Error: ${pipelinesDest} already exists.`);
        process.exit(1);
      }
      writeFileSync(pipelinesDest, PIPELINE_TEMPLATE);
      setActivePipeline(dir, "default");

      // Also write to root for backward compat with `openthk run -p`
      if (!existsSync(pipelineFile)) {
        writeFileSync(pipelineFile, PIPELINE_TEMPLATE);
      }

      const displayName = name === "." ? "current directory" : name;
      console.log(`Initialized OpenThinking project in ${displayName}`);
      console.log("  Created .openthk/pipelines/default.yaml");
      console.log("  Created skills/");
      if (isNew) {
        console.log("  Created .openthk/ (project workspace)");
      }
      console.log("\nNext steps:");
      console.log("  1. Run 'openthk' and use /providers setup to configure API keys");
      console.log("  2. Edit .openthk/pipelines/default.yaml to configure your pipeline");
      console.log("  3. Edit .openthk/project.md to describe your project");
      console.log("  4. Run 'openthk' and type your prompt to execute the pipeline");
    });
}
