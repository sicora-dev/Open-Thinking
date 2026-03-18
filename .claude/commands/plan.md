---
description: Show the Phase 1 roadmap and pick up the next task to implement. Tracks progress via TODO markers in source files.
allowed-tools: Read, Grep, Glob, Write, Bash(bun:*), Bash(grep:*), Bash(wc:*)
---

## Phase 1 — Core Engine Roadmap

Check the current state of implementation by scanning the codebase:

1. `grep -r "TODO:" src/ --include="*.ts" -c` to count remaining TODOs
2. Check which modules exist and which are stubs

### Task Order (implement in this sequence)

1. **Shared types and utilities** (`src/shared/`)
   - `types.ts` — Core type definitions (PipelineConfig, StageDefinition, etc.)
   - `result.ts` — Result<T, E> type and helper functions (ok, err, map, flatMap)
   - `errors.ts` — Custom error types (PipelineError, ProviderError, ContextError, PolicyError)
   - `logger.ts` — Simple structured logger (JSON output, log levels)

2. **Pipeline YAML parser** (`src/pipeline/parser/`)
   - Parse and validate `openmind.pipeline.yaml`
   - Env var interpolation (`${ENV_VAR}`)
   - Schema validation with clear error messages
   - Return `Result<PipelineConfig, ParseError>`

3. **Provider adapter — OpenAI compatible** (`src/providers/adapters/`)
   - Base adapter implementing `LLMProvider` interface
   - Chat completion (non-streaming first)
   - SSE streaming
   - Health check and model listing
   - Anthropic-specific adapter (extends base, adds Anthropic headers)
   - Ollama adapter (extends base, localhost)

4. **Context store** (`src/context/store/`)
   - SQLite-backed key-value store
   - Namespaced keys with dot notation
   - Read/write with policy enforcement
   - TTL support
   - `inspect()` method for CLI

5. **Policy engine** (`src/policies/engine/`)
   - Evaluate read/write permissions per stage
   - Glob pattern matching for context keys
   - Rate limiting (token bucket)
   - Cost tracking

6. **Stage executor** (`src/pipeline/executor/`)
   - Sequential execution
   - Build context payload per stage permissions
   - Call provider with skill prompt + context
   - Write results to context store
   - Handle failures (retry, re-route)

7. **CLI commands** (`src/cli/commands/`)
   - `init` — scaffold project
   - `run` — execute pipeline
   - `validate` — check pipeline YAML
   - `provider add/list/test`
   - `context inspect/clear`

### Pick the next task

Identify which tasks are done (have real implementations, not stubs) and which are pending. Tell me the next task to work on and start implementing it.
