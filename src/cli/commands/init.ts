import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
/**
 * `openmind init [name]` — Scaffold a new OpenMind project.
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
# API keys come from ~/.openmind/providers.json (run: openmind, then /providers setup).
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
    .description("Initialize a new OpenMind project")
    .argument("[name]", "Project name", ".")
    .action(async (name: string) => {
      const dir = resolve(name === "." ? process.cwd() : name);
      const pipelineFile = join(dir, "openmind.pipeline.yaml");
      const skillsDir = join(dir, "skills");

      // Initialize workspace directories first (creates .openmind/pipelines/)
      ensureGlobalWorkspace();

      if (name !== ".") {
        mkdirSync(dir, { recursive: true });
      }
      mkdirSync(skillsDir, { recursive: true });

      const isNew = initProjectWorkspace(dir);

      // Write pipeline into .openmind/pipelines/
      const pipelinesDest = join(dir, ".openmind", "pipelines", "default.yaml");
      if (existsSync(pipelinesDest)) {
        console.error(`Error: ${pipelinesDest} already exists.`);
        process.exit(1);
      }
      writeFileSync(pipelinesDest, PIPELINE_TEMPLATE);
      setActivePipeline(dir, "default");

      // Also write to root for backward compat with `openmind run -p`
      if (!existsSync(pipelineFile)) {
        writeFileSync(pipelineFile, PIPELINE_TEMPLATE);
      }

      const displayName = name === "." ? "current directory" : name;
      console.log(`Initialized OpenMind project in ${displayName}`);
      console.log("  Created .openmind/pipelines/default.yaml");
      console.log("  Created skills/");
      if (isNew) {
        console.log("  Created .openmind/ (project workspace)");
      }
      console.log("\nNext steps:");
      console.log("  1. Run 'openmind' and use /providers setup to configure API keys");
      console.log("  2. Edit .openmind/pipelines/default.yaml to configure your pipeline");
      console.log("  3. Edit .openmind/project.md to describe your project");
      console.log("  4. Run 'openmind' and type your prompt to execute the pipeline");
    });
}
