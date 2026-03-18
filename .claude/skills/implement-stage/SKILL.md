---
name: implement-stage
description: Implement or modify a pipeline stage component. Use when working on the stage executor, stage routing, stage lifecycle, or anything related to how stages run within a pipeline.
allowed-tools: Read, Write, Bash(bun:*), Grep, Glob
---

When implementing pipeline stage functionality:

## Context

A **stage** is a single step in a pipeline. It has:
- A provider + model (which LLM to use)
- A skill (instructions for the LLM)
- Context permissions (what it can read/write)
- Dependencies (which stages must complete first)
- Failure handling (retry, re-route)

## Architecture

```
Pipeline YAML → Parser → StageDefinition[] → Executor → Results
                                                  ↓
                                            Context Store (read/write per policy)
```

## Key Types

Reference `src/shared/types.ts` for:
- `StageDefinition` — parsed stage config
- `StageResult` — execution result (success/failure + outputs)
- `StageStatus` — enum: pending | running | success | failed | skipped

## Implementation Rules

1. **Stage executor** receives a `StageDefinition` and returns `Promise<Result<StageResult>>`
2. Before executing, the executor MUST:
   - Resolve the skill (load prompt template + tools)
   - Build the context payload (only keys the stage is allowed to read)
   - Validate against policies
3. During execution:
   - Stream LLM response via SSE
   - Emit events to the event bus (stage:start, stage:progress, stage:complete, stage:error)
4. After execution:
   - Write outputs to context store (only allowed keys)
   - Return structured result

## Testing

Test each stage lifecycle phase independently:
- Test context permission enforcement (should reject unauthorized reads/writes)
- Test failure handling (retry logic, re-routing)
- Test event emission
- Use mock providers in tests (never call real LLM APIs in unit tests)
