import { describe, expect, test } from "bun:test";
import { executeSlashCommand, getCommandCompletions } from "./slash-commands";
import type { ReplState } from "./slash-commands";

function baseState(): ReplState {
  return {
    pipelineConfig: null,
    pipelinePath: null,
    workingDir: "/tmp/test-project",
    skillsDir: null,
  };
}

function stateWithPipeline(): ReplState {
  return {
    ...baseState(),
    pipelineConfig: {
      name: "test-pipeline",
      version: "1.0.0",
      context: { backend: "sqlite", vector: "embedded", ttl: "7d" },
      providers: {
        openai: {
          type: "openai-compatible",
          base_url: "https://api.openai.com/v1",
          api_key: "sk-test",
        },
      },
      stages: {
        planner: {
          provider: "openai",
          model: "gpt-4",
          skill: "core/arch-planner@1.0",
          context: { read: ["input.*"], write: ["plan.*"] },
        },
        coder: {
          provider: "openai",
          model: "gpt-4",
          skill: "core/code-writer@1.0",
          context: { read: ["plan.*"], write: ["code.*"] },
          depends_on: ["planner"],
        },
      },
      policies: { global: {} },
    },
    pipelinePath: "/tmp/test-project/openthk.pipeline.yaml",
  };
}

describe("Slash Commands", () => {
  test("/help returns command list", async () => {
    const result = await executeSlashCommand("help", baseState());
    expect(result.output).toContain("/help");
    expect(result.output).toContain("/pipeline");
    expect(result.output).toContain("/exit");
  });

  test("/h alias works", async () => {
    const result = await executeSlashCommand("h", baseState());
    expect(result.output).toContain("/help");
  });

  test("unknown command returns error", async () => {
    const result = await executeSlashCommand("foobar", baseState());
    expect(result.output).toContain("Unknown command");
    expect(result.output).toContain("foobar");
  });

  test("/pipeline shows no pipeline when none loaded", async () => {
    const result = await executeSlashCommand("pipeline", baseState());
    expect(result.output).toContain("No pipeline loaded");
  });

  test("/pipeline shows loaded pipeline info", async () => {
    const result = await executeSlashCommand("pipeline", stateWithPipeline());
    expect(result.output).toContain("test-pipeline");
    expect(result.output).toContain("1.0.0");
    expect(result.output).toContain("openai");
  });

  test("/model lists stage models", async () => {
    const result = await executeSlashCommand("model", stateWithPipeline());
    expect(result.output).toContain("planner");
    expect(result.output).toContain("gpt-4");
    expect(result.output).toContain("coder");
  });

  test("/m alias works", async () => {
    const result = await executeSlashCommand("m", stateWithPipeline());
    expect(result.output).toContain("gpt-4");
  });

  test("/stages lists stages with dependencies", async () => {
    const result = await executeSlashCommand("stages", stateWithPipeline());
    expect(result.output).toContain("planner");
    expect(result.output).toContain("coder");
    expect(result.output).toContain("depends on: planner");
  });

  test("/providers list shows global providers info", async () => {
    const result = await executeSlashCommand("providers list", stateWithPipeline());
    // Shows either configured providers or "no providers" message
    expect(result.output).toContain("provider");
  });

  test("/exit sets exit flag", async () => {
    const result = await executeSlashCommand("exit", baseState());
    expect(result.exit).toBe(true);
    expect(result.output).toContain("Goodbye");
  });

  test("/quit alias works", async () => {
    const result = await executeSlashCommand("quit", baseState());
    expect(result.exit).toBe(true);
  });

  test("/pipeline load <path> shows error for nonexistent file", async () => {
    const result = await executeSlashCommand("pipeline load /nonexistent/file.yaml", baseState());
    expect(result.output).toContain("File not found");
  });

  test("/pipeline unknown subcommand shows error", async () => {
    const result = await executeSlashCommand("pipeline show", baseState());
    expect(result.output).toContain("Unknown");
  });

  test("getCommandCompletions returns all commands", () => {
    const completions = getCommandCompletions();
    expect(completions).toContain("/help");
    expect(completions).toContain("/pipeline");
    expect(completions).toContain("/exit");
    expect(completions).toContain("/h");
    expect(completions).toContain("/q");
    expect(completions).toContain("/p");
  });
});
