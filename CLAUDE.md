# OpenMind — AI Pipeline Orchestrator

## What is this project?

OpenMind is an open-source CLI-first tool that lets development teams create shared AI workflows where multiple LLMs collaborate on tasks with shared context. Think "Kubernetes for AI agents."

**Core idea**: A team defines a pipeline in YAML (e.g., planning → development → testing), assigns a different LLM to each stage (Opus for planning, Kimi for coding, Sonnet for testing), and the tool orchestrates execution with shared context, access policies, and reusable skills.

## Tech Stack

- **Language**: TypeScript (strict mode, no `any`)
- **Runtime**: Bun (primary), Node.js 20+ (compatible)
- **CLI framework**: `@commander-js/extra-typings` for type-safe CLI
- **HTTP client**: Built-in `fetch` (Bun/Node 18+)
- **Streaming**: Server-Sent Events (SSE) for LLM streaming
- **Config parsing**: `yaml` package for pipeline definitions
- **Database**: `better-sqlite3` for local context store
- **Vector search**: `vectra` (local vector DB in TypeScript) for semantic context
- **Testing**: `bun:test` (primary), vitest (fallback)
- **Build**: `bun build --compile` for single binary distribution
- **Linting**: Biome (formatter + linter)

## Architecture Overview

```
src/
├── cli/              # CLI entry point and commands
│   ├── commands/     # Each CLI command (run, init, provider, skill, context)
│   └── ui/           # Terminal UI helpers (spinners, tables, colors)
├── core/             # Core orchestration engine
│   ├── engine/       # Pipeline execution engine
│   └── events/       # Event bus for stage communication
├── pipeline/         # Pipeline definition and execution
│   ├── parser/       # YAML pipeline parser + validator
│   ├── executor/     # Stage executor (sequential, parallel, conditional)
│   └── router/       # Conditional routing (on_fail, on_success)
├── providers/        # LLM provider abstraction
│   └── adapters/     # Specific adapters (openai-compat, ollama, custom)
├── context/          # Shared context system
│   ├── store/        # Key-value context store (SQLite)
│   └── vector/       # Vector store for semantic search
├── skills/           # Skill system
│   └── runtime/      # WASM skill runtime (future) / TS skill runtime (v1)
├── policies/         # Access control and policies
│   ├── engine/       # Policy evaluation engine
│   └── rules/        # Built-in policy rules
├── shared/           # Shared types, utils, errors
└── dashboard/        # Web dashboard (Phase 3)
```

## Key Design Decisions

1. **Provider protocol**: All LLMs are accessed through an OpenAI-compatible interface. Providers that don't support it natively (Anthropic) get an adapter that translates.

2. **Context store**: Key-value with namespaces. Keys use dot notation: `plan.architecture`, `code.files`, `test.results`. Each stage declares what it can read/write in the pipeline YAML.

3. **Skills in v1**: Plain TypeScript modules (not WASM yet). A skill is a directory with a `skill.yaml` manifest + a `prompt.md` template + optional TypeScript tool functions. WASM runtime comes in Phase 2.

4. **Pipeline execution**: Stages run sequentially by default. `depends_on` creates a DAG. The executor resolves the DAG and runs independent stages in parallel.

5. **Policies are declarative**: Defined in pipeline YAML, evaluated before each context read/write. A stage trying to write outside its allowed namespaces gets a hard error.

## Code Conventions

- All files use `.ts` extension
- Prefer `type` over `interface` for object shapes
- Use `Result<T, E>` pattern for errors (no throwing in core logic):
  ```typescript
  type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
  ```
- Async functions return `Promise<Result<T, E>>`, never throw
- Use barrel exports (`index.ts`) in each directory
- Name files in kebab-case: `pipeline-parser.ts`, `context-store.ts`
- Name types in PascalCase: `PipelineConfig`, `StageDefinition`
- Name functions in camelCase: `parsePipeline`, `executeStage`
- Tests live next to source: `pipeline-parser.ts` → `pipeline-parser.test.ts`
- Use `Bun.env` for environment variables, with fallback to `process.env`

## Pipeline YAML Schema

```yaml
name: string                    # Pipeline name
version: string                 # Semver

context:
  backend: sqlite | postgres    # Storage backend
  vector: embedded | qdrant     # Vector search backend
  ttl: string                   # Context expiration (e.g., "7d")

providers:
  [name]:
    type: openai-compatible | ollama | custom
    base_url: string
    api_key: string             # Supports ${ENV_VAR} interpolation

stages:
  [name]:
    provider: string            # Reference to providers section
    model: string               # Model identifier
    skill: string               # Skill reference (namespace/name@version)
    context:
      read: string[]            # Glob patterns for readable context keys
      write: string[]           # Glob patterns for writable context keys
    depends_on: string[]        # Stage dependencies (DAG)
    max_tokens: number          # Max tokens per request
    temperature: number         # Temperature (0-2)
    on_fail:
      retry_stage: string       # Stage to re-run on failure
      max_retries: number
      inject_context: string    # Context key to inject failure info

policies:
  global:
    rate_limit: string          # Rate limit per stage
    audit_log: boolean          # Enable audit logging
    cost_limit: string          # Max cost per pipeline run
```

## CLI Commands (Target)

```
openmind init [name]           # Initialize new project
openmind run --pipeline <name> # Execute a pipeline
openmind run --stage <name>    # Execute single stage
openmind provider add <name>   # Add LLM provider
openmind provider list         # List configured providers
openmind provider test <name>  # Test provider connection
openmind skill install <ref>   # Install a skill
openmind skill create <name>   # Scaffold a new skill
openmind skill list            # List installed skills
openmind context inspect       # Show current context state
openmind context clear         # Clear context store
openmind validate              # Validate pipeline YAML
openmind dashboard             # Launch web dashboard (Phase 3)
```

## Current Phase: Phase 1 — Core Engine

We are building the foundation. Priority order:
1. ✅ Project scaffold and build system
2. CLI entry point with `init` and `run` commands
3. Pipeline YAML parser and validator
4. Provider adapter (OpenAI-compatible base)
5. Sequential stage executor
6. Context store (SQLite, key-value with namespaces)
7. Basic policy engine (read/write access control)

## Commands

- `bun run dev` — Run CLI in development mode
- `bun run build` — Compile to single binary
- `bun run test` — Run all tests
- `bun run lint` — Run Biome linter
- `bun run format` — Run Biome formatter
- `bun run typecheck` — TypeScript type checking
