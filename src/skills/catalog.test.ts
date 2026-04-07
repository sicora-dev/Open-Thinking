import { describe, expect, test } from "bun:test";
import {
  getBuiltInSkillsDir,
  getProjectSkillsDir,
  listBuiltInSkillRefs,
  loadSkillDefinition,
} from "./catalog";

describe("skill catalog", () => {
  test("loads built-in core skills when custom roots are missing", () => {
    const skill = loadSkillDefinition("core/orchestrator@1.0", "/tmp/does-not-exist");
    expect(skill.path).toContain("/examples/skills/core/orchestrator");
    expect(skill.prompt).toContain("You are an orchestrator");
    expect(skill.allowedTools).toEqual([]);
  });

  test("project skill dir lives under .openthk/pipelines/skills", () => {
    expect(getProjectSkillsDir("/tmp/project")).toBe("/tmp/project/.openthk/pipelines/skills");
    expect(getBuiltInSkillsDir()).toContain("/examples/skills");
  });

  test("lists embedded built-in skills for binary/runtime fallback", () => {
    expect(listBuiltInSkillRefs()).toContain("core/orchestrator");
    expect(listBuiltInSkillRefs()).toContain("core/code-writer");
  });
});
