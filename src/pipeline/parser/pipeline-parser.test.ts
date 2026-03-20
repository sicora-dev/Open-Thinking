import { describe, expect, it } from "bun:test";
import { parsePipelineFromString } from "./pipeline-parser";

// ─── New format: providers as a list of names ────────────────
const VALID_PIPELINE = `
name: test-pipeline
version: "1.0"

context:
  backend: sqlite
  vector: embedded
  ttl: 7d

providers:
  - openai

stages:
  planning:
    provider: openai
    model: gpt-4o
    skill: test/planner@1.0
    context:
      read: [requirements.*]
      write: [plan.*]

  develop:
    provider: openai
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

// ─── Legacy format: providers as records ─────────────────────
const LEGACY_PIPELINE = `
name: legacy-pipeline
version: "1.0"

providers:
  my-provider:
    type: openai-compatible
    base_url: https://api.example.com/v1
    api_key: test-key-123

stages:
  planning:
    provider: my-provider
    model: gpt-4o
    skill: test/planner@1.0
    context:
      read: []
      write: [plan.*]

policies:
  global: {}
`;

describe("parsePipelineFromString", () => {
  it("parses a valid pipeline with provider list", () => {
    const result = parsePipelineFromString(VALID_PIPELINE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.name).toBe("test-pipeline");
    expect(result.value.version).toBe("1.0");
    expect(Object.keys(result.value.providers)).toEqual(["openai"]);
    expect(result.value.providers.openai?.base_url).toContain("openai.com");
    expect(Object.keys(result.value.stages)).toEqual(["planning", "develop"]);
  });

  it("parses legacy record-based providers", () => {
    const result = parsePipelineFromString(LEGACY_PIPELINE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.name).toBe("legacy-pipeline");
    expect(Object.keys(result.value.providers)).toEqual(["my-provider"]);
    expect(result.value.providers["my-provider"]?.base_url).toBe("https://api.example.com/v1");
  });

  it("parses mixed array with custom providers", () => {
    const yaml = `
name: mixed
version: "1.0"
providers:
  - openai
  - id: my-custom
    base_url: https://custom.api.com/v1
    api_key: custom-key
stages:
  s1:
    provider: openai
    model: gpt-4o
    skill: s@1
    context: { read: [], write: [] }
  s2:
    provider: my-custom
    model: custom-model
    skill: s@1
    context: { read: [], write: [] }
policies:
  global: {}
`;
    const result = parsePipelineFromString(yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.value.providers)).toEqual(["openai", "my-custom"]);
    expect(result.value.providers["my-custom"]?.base_url).toBe("https://custom.api.com/v1");
  });

  it("rejects unknown provider names in list", () => {
    const yaml = `
name: bad
version: "1.0"
providers:
  - totally-fake-provider
stages:
  s1:
    provider: totally-fake-provider
    model: m
    skill: s@1
    context: { read: [], write: [] }
policies:
  global: {}
`;
    const result = parsePipelineFromString(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("totally-fake-provider");
  });

  it("validates stage dependencies exist", () => {
    const yaml = `
name: bad-deps
version: "1.0"
providers:
  - openai
stages:
  stage-a:
    provider: openai
    model: gpt-4o
    skill: test/s@1.0
    context: { read: [], write: [] }
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
  - openai
stages:
  stage-a:
    provider: fake-provider
    model: gpt-4o
    skill: test/s@1.0
    context: { read: [], write: [] }
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
providers: []
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
  - openai
stages:
  a:
    provider: openai
    model: m
    skill: s@1
    context: { read: [], write: [] }
    depends_on: [b]
  b:
    provider: openai
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

  it("defaults context and policies when omitted", () => {
    const yaml = `
name: minimal
version: "1.0"
providers:
  - openai
stages:
  s1:
    provider: openai
    model: gpt-4o
    skill: s@1
    context: { read: [], write: [] }
`;
    const result = parsePipelineFromString(yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.context.backend).toBe("sqlite");
    expect(result.value.policies.global).toBeDefined();
  });

  // ─── Pipeline mode ──────────────────────────────────────────

  it("defaults mode to sequential", () => {
    const result = parsePipelineFromString(VALID_PIPELINE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mode).toBe("sequential");
  });

  it("parses orchestrated mode with valid orchestrator", () => {
    const yaml = `
name: orchestrated-pipeline
version: "1.0"
mode: orchestrated
providers:
  - openai
stages:
  orchestrator:
    provider: openai
    model: gpt-4o
    skill: core/orchestrator@1.0
    role: orchestrator
    context: { read: ["*"], write: ["orchestrator.*"] }
  coder:
    provider: openai
    model: gpt-4o
    skill: core/coder@1.0
    context: { read: ["*"], write: ["code.*"] }
`;
    const result = parsePipelineFromString(yaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mode).toBe("orchestrated");
    expect(result.value.stages.orchestrator?.role).toBe("orchestrator");
  });

  it("rejects orchestrated mode without orchestrator role", () => {
    const yaml = `
name: bad-orchestrated
version: "1.0"
mode: orchestrated
providers:
  - openai
stages:
  s1:
    provider: openai
    model: gpt-4o
    skill: s@1
    context: { read: [], write: [] }
`;
    const result = parsePipelineFromString(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("orchestrator");
  });

  it("rejects multiple orchestrators", () => {
    const yaml = `
name: multi-orchestrator
version: "1.0"
mode: orchestrated
providers:
  - openai
stages:
  orch1:
    provider: openai
    model: gpt-4o
    skill: s@1
    role: orchestrator
    context: { read: [], write: [] }
  orch2:
    provider: openai
    model: gpt-4o
    skill: s@1
    role: orchestrator
    context: { read: [], write: [] }
`;
    const result = parsePipelineFromString(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("only one orchestrator");
  });

  it("rejects orchestrator role in sequential mode", () => {
    const yaml = `
name: bad-role
version: "1.0"
providers:
  - openai
stages:
  s1:
    provider: openai
    model: gpt-4o
    skill: s@1
    role: orchestrator
    context: { read: [], write: [] }
`;
    const result = parsePipelineFromString(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("sequential");
  });

  it("rejects invalid mode value", () => {
    const yaml = `
name: bad-mode
version: "1.0"
mode: invalid
providers:
  - openai
stages:
  s1:
    provider: openai
    model: gpt-4o
    skill: s@1
    context: { read: [], write: [] }
`;
    const result = parsePipelineFromString(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("invalid");
  });
});
