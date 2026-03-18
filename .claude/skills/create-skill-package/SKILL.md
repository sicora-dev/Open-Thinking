---
name: create-skill-package
description: Create a new OpenMind skill package. Use when the user wants to create a reusable skill that LLMs will use inside pipeline stages (like arch-planner, code-writer, test-gen, etc.).
allowed-tools: Read, Write, Bash(mkdir:*), Bash(bun:*)
---

When creating an OpenMind skill package:

## What is an OpenMind Skill?

A skill is a reusable package that tells an LLM how to behave in a pipeline stage. It includes:
- A system prompt template
- Optional tool definitions (functions the LLM can call)
- A manifest with metadata and constraints

## Skill Structure

```
skills-registry/examples/{skill-name}/
├── skill.yaml        # Manifest: name, version, description, constraints
├── prompt.md         # System prompt template (supports {{variables}})
├── tools/            # Optional: TypeScript tool functions
│   ├── index.ts      # Tool exports
│   └── {tool}.ts     # Individual tool implementations
└── README.md         # Usage documentation
```

## skill.yaml Schema

```yaml
name: namespace/skill-name    # e.g., openmind/arch-planner
version: "1.0.0"
description: Short description of what this skill does
author: string

# What context this skill typically needs
context:
  reads: [plan.*]              # Suggested read permissions
  writes: [plan.architecture]  # Suggested write permissions

# Tool definitions (if the skill provides tools)
tools:
  - name: write_file
    description: Write a file to the workspace
    parameters:
      path: { type: string, required: true }
      content: { type: string, required: true }

# Constraints
constraints:
  min_tokens: 4000             # Minimum max_tokens recommended
  recommended_models:          # Models this skill works best with
    - claude-opus-4-5-*
    - gpt-4o
```

## prompt.md Template

Use `{{variable}}` for dynamic content injected at runtime:
- `{{context}}` — serialized context the stage is allowed to read
- `{{task}}` — the pipeline input / task description
- `{{stage_name}}` — current stage name
- `{{previous_results}}` — outputs from dependent stages

## Creating Tools

Tools are TypeScript functions the LLM can call during execution:

```typescript
// tools/write-file.ts
import type { ToolFunction } from '../../../src/shared/types';

export const writeFile: ToolFunction = {
  name: 'write_file',
  description: 'Write content to a file in the workspace',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to workspace' },
      content: { type: 'string', description: 'File content to write' },
    },
    required: ['path', 'content'],
  },
  execute: async ({ path, content }) => {
    // Implementation
    return { ok: true, value: { path, bytesWritten: content.length } };
  },
};
```

## After Creating

1. Test the skill in isolation with a mock provider
2. Add an example pipeline YAML that uses this skill in the README
3. Register in `skills-registry/examples/` for now (public registry in Phase 4)
