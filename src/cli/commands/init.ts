import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
/**
 * `openmind init [name]` — Scaffold a new OpenMind project.
 */
import type { Command } from "commander";

const PIPELINE_TEMPLATE = `name: my-pipeline
version: "0.1.0"

context:
  backend: sqlite
  vector: embedded
  ttl: "7d"

providers:
  openai:
    type: openai-compatible
    base_url: https://api.openai.com/v1
    api_key: \${OPENAI_API_KEY}

stages:
  planner:
    provider: openai
    model: gpt-4
    skill: core/arch-planner@1.0
    context:
      read: []
      write: ["plan.*"]

  coder:
    provider: openai
    model: gpt-4
    skill: core/code-writer@1.0
    context:
      read: ["plan.*"]
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

      if (existsSync(pipelineFile)) {
        console.error(`Error: ${pipelineFile} already exists.`);
        process.exit(1);
      }

      if (name !== ".") {
        mkdirSync(dir, { recursive: true });
      }
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(pipelineFile, PIPELINE_TEMPLATE);

      const displayName = name === "." ? "current directory" : name;
      console.log(`Initialized OpenMind project in ${displayName}`);
      console.log("  Created openmind.pipeline.yaml");
      console.log("  Created skills/");
      console.log("\nNext steps:");
      console.log("  1. Set your OPENAI_API_KEY environment variable");
      console.log("  2. Edit openmind.pipeline.yaml to configure your pipeline");
      console.log("  3. Run: openmind run -p openmind.pipeline.yaml");
    });
}
