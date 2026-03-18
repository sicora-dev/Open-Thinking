import { describe, expect, it } from "bun:test";
import { parsePipelineFromString } from "./pipeline-parser";

const VALID_PIPELINE = `
name: test-pipeline
version: "1.0"

context:
  backend: sqlite
  vector: embedded
  ttl: 7d

providers:
  test-provider:
    type: openai-compatible
    base_url: https://api.example.com/v1
    api_key: test-key-123

stages:
  planning:
    provider: test-provider
    model: gpt-4o
    skill: test/planner@1.0
    context:
      read: [requirements.*]
      write: [plan.*]

  develop:
    provider: test-provider
    model: gpt-4o
    skill: test/coder@1.0
    context:
      read: [plan.*]
      write: [code.*]
    depends_on: [planning]

policies:
  global:
    rate_limit: 100/hour
    audit_log: true
`;

describe("parsePipelineFromString", () => {
  it("parses a valid pipeline YAML", () => {
    const result = parsePipelineFromString(VALID_PIPELINE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.name).toBe("test-pipeline");
    expect(result.value.version).toBe("1.0");
    expect(Object.keys(result.value.providers)).toEqual(["test-provider"]);
    expect(Object.keys(result.value.stages)).toEqual(["planning", "develop"]);
  });

  it("validates stage dependencies exist", () => {
    const yaml = `
name: bad-deps
version: "1.0"
providers:
  p:
    type: openai-compatible
    base_url: https://api.example.com
stages:
  stage-a:
    provider: p
    model: gpt-4o
    skill: test/s@1.0
    context:
      read: []
      write: []
    depends_on: [non-existent-stage]
policies:
  global: {}
`;
    const result = parsePipelineFromString(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("non-existent-stage");
  });

  it("validates provider references in stages", () => {
    const yaml = `
name: bad-provider
version: "1.0"
providers:
  real-provider:
    type: openai-compatible
    base_url: https://api.example.com
stages:
  stage-a:
    provider: fake-provider
    model: gpt-4o
    skill: test/s@1.0
    context:
      read: []
      write: []
policies:
  global: {}
`;
    const result = parsePipelineFromString(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("fake-provider");
  });

  it("rejects invalid YAML syntax", () => {
    const result = parsePipelineFromString("{ invalid: yaml: [broken");
    expect(result.ok).toBe(false);
  });

  it("rejects missing name field", () => {
    const yaml = `
version: "1.0"
providers: {}
stages: {}
policies:
  global: {}
`;
    const result = parsePipelineFromString(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("name");
  });

  it("detects circular dependencies", () => {
    const yaml = `
name: circular
version: "1.0"
providers:
  p:
    type: openai-compatible
    base_url: https://api.example.com
stages:
  a:
    provider: p
    model: m
    skill: s@1
    context: { read: [], write: [] }
    depends_on: [b]
  b:
    provider: p
    model: m
    skill: s@1
    context: { read: [], write: [] }
    depends_on: [a]
policies:
  global: {}
`;
    const result = parsePipelineFromString(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Circular dependency");
  });

  it("preserves stage ordering from YAML", () => {
    const result = parsePipelineFromString(VALID_PIPELINE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stageNames = Object.keys(result.value.stages);
    expect(stageNames[0]).toBe("planning");
    expect(stageNames[1]).toBe("develop");
  });
});
