# OpenMind — AI Pipeline Orchestrator

## What is this project?

OpenMind is an open-source CLI-first tool that lets development teams create shared AI workflows where multiple LLMs collaborate on tasks with shared context. Think "Kubernetes for AI agents."

**Core idea**: A team defines a pipeline in YAML (e.g., planning → development → testing), assigns a different LLM to each stage (Opus for planning, Sonnet for coding, etc.), and the tool orchestrates execution with shared context, access policies, and reusable skills.

## Tech Stack

- **Language**: TypeScript (strict mode, no `any`)
- **Runtime**: Bun (primary), Node.js 20+ (compatible)
- **CLI**: Interactive REPL shell (like Claude Code) + Commander.js for one-shot subcommands
- **HTTP client**: Built-in `fetch` (Bun/Node 18+)
- **Streaming**: Server-Sent Events (SSE) for LLM streaming
- **Config parsing**: `yaml` package for pipeline definitions
- **Database**: `bun:sqlite` for local context store
- **Vector search**: `vectra` (local vector DB in TypeScript) for semantic context
- **Testing**: `bun:test` (primary), vitest (fallback)
- **Build**: `bun build --compile` for single binary distribution
- **Linting**: Biome (formatter + linter)

## Architecture Overview

```
src/
├── cli/              # CLI entry point and interactive REPL
│   ├── commands/     # One-shot CLI commands (init, run, validate)
│   └── repl/         # Interactive REPL shell, slash commands
├── config/           # Global configuration (~/.openmind/)
│   ├── global-config # Provider API key storage
│   ├── provider-catalog # Built-in provider definitions (18+ providers)
│   └── setup-wizard  # Interactive provider setup with arrow-key navigation
├── core/             # Core orchestration engine
│   └── events/       # Event bus for stage communication
├── pipeline/         # Pipeline definition and execution
│   ├── parser/       # YAML pipeline parser + validator + provider resolver
│   └── executor/     # Stage executor (DAG), agent loop
├── providers/        # LLM provider abstraction
│   └── adapters/     # Specific adapters (openai-compat, anthropic, ollama)
├── tools/            # Built-in tools for LLM agent loop (read_file, write_file, etc.)
├── context/          # Shared context system
│   └── store/        # Key-value context store (SQLite via bun:sqlite)
├── skills/           # Skill system (prompt.md templates)
├── policies/         # Access control and policies
│   └── engine/       # Policy evaluation engine (glob matching, rate limit, cost)
├── shared/           # Shared types, utils, errors
└── dashboard/        # Web dashboard (Phase 3 — not implemented yet)
```

## Key Design Decisions

1. **Interactive REPL**: Running `openmind` opens an interactive shell (like Claude Code). Slash commands (`/pipeline`, `/providers`, `/help`) for configuration, natural language for pipeline execution.

2. **Global provider config**: API keys are stored globally in `~/.openmind/providers.json`, not per-project. The setup wizard (`/providers setup`) presents an interactive list with arrow-key navigation.

3. **Simplified YAML**: Users only declare provider names in the pipeline YAML — `type`, `base_url`, and `api_key` are all resolved automatically from the provider catalog and global config. No need for env vars or manual URLs.

4. **Provider protocol**: All LLMs are accessed through an OpenAI-compatible interface. Providers that don't support it natively (Anthropic) get an adapter that translates.

5. **Context store**: Key-value with namespaces. Keys use dot notation: `plan.architecture`, `code.files`, `test.results`. Each stage declares what it can read/write.

6. **Agent loop**: Each stage runs an iterative agent loop (chat → tool calls → execute → chat) with built-in filesystem tools (read_file, write_file, list_files, run_command, search_files).

7. **Pipeline execution**: Stages run sequentially by default. `depends_on` creates a DAG. The executor resolves the DAG and runs independent stages in parallel.

8. **Policies are declarative**: Defined in pipeline YAML, evaluated before each context read/write. A stage trying to write outside its allowed namespaces gets a hard error.

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

**IMPORTANT**: Providers are declared as a simple list of names. The parser resolves
`type`, `base_url`, and `api_key` automatically from the provider catalog
(`src/config/provider-catalog.ts`) and global config (`~/.openmind/providers.json`).
Users should NEVER have to specify `type`, `base_url`, or `api_key` in the YAML
for known providers. The old record-based format is still supported for backward
compatibility but should not be used in new code or examples.

```yaml
name: string                    # Pipeline name
version: string                 # Semver

context:                        # Optional (defaults to sqlite/embedded/7d)
  backend: sqlite | postgres    # Storage backend
  vector: embedded | qdrant     # Vector search backend
  ttl: string                   # Context expiration (e.g., "7d")

# Providers: just list names from the catalog.
# API keys come from ~/.openmind/providers.json (setup via /providers setup).
providers:
  - openai                      # Resolved to https://api.openai.com/v1
  - anthropic                   # Resolved to https://api.anthropic.com/v1
  - ollama                      # Resolved to http://localhost:11434
  # Custom provider (not in catalog):
  - id: my-custom
    base_url: https://custom.api.com/v1
    api_key: ${MY_CUSTOM_KEY}   # Only custom providers need explicit config

stages:
  [name]:
    provider: string            # Must match a name from the providers list
    model: string               # Model identifier (e.g., "gpt-4o", "claude-sonnet-4-20250514")
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

policies:                       # Optional
  global:
    rate_limit: string          # Rate limit per stage
    audit_log: boolean          # Enable audit logging
    cost_limit: string          # Max cost per pipeline run
```

### Available Provider Names (catalog)

Cloud: `openai`, `anthropic`, `google`, `mistral`, `xai`, `deepseek`, `groq`, `together`, `fireworks`, `openrouter`, `perplexity`, `cohere`, `azure`, `bedrock`

Local: `ollama`, `lmstudio`, `llamacpp`

### Internal Type: `ResolvedProvider`

After parsing, each provider in the YAML becomes a `ResolvedProvider` object:
```typescript
type ResolvedProvider = {
  type: "openai-compatible" | "ollama" | "custom";
  base_url: string;
  api_key?: string;
  headers?: Record<string, string>;
};
```
This is the internal representation — users never write these fields manually.
`PipelineConfig.providers` is `Record<string, ResolvedProvider>`.

## CLI Usage

```
openmind                       # Open interactive REPL shell
openmind init [name]           # Initialize new project (one-shot)
openmind run -p <file>         # Execute pipeline (one-shot)
openmind validate -f <file>    # Validate pipeline YAML (one-shot)
```

### REPL Slash Commands

```
/help                          # Show all commands
/pipeline [path]               # Show or load a pipeline
/providers setup               # Interactive provider setup wizard
/providers list                # List configured API keys
/providers remove <id>         # Remove a provider
/model                         # Show models per stage
/stages                        # Show stages and dependencies
/skills                        # List available skills
/context [inspect|clear]       # Context store management
/clear                         # Clear terminal
/exit                          # Exit
```

## Current Phase: Phase 1 — Core Engine (COMPLETE)

All core engine components are implemented:
1. ✅ Project scaffold and build system
2. ✅ Interactive REPL shell with slash commands
3. ✅ Pipeline YAML parser and validator (simplified provider format)
4. ✅ Provider adapters (OpenAI-compatible, Anthropic, Ollama) + factory
5. ✅ Stage executor with DAG resolution and agent loop
6. ✅ Context store (SQLite via bun:sqlite, key-value with namespaces)
7. ✅ Policy engine (glob matching, rate limiting, cost tracking)
8. ✅ Built-in tools (read_file, write_file, list_files, run_command, search_files)
9. ✅ Global provider config with interactive setup wizard (18+ providers)

## Commands

- `bun run dev` — Run CLI in development mode
- `bun run build` — Compile to single binary
- `bun run test` — Run all tests
- `bun run lint` — Run Biome linter
- `bun run format` — Run Biome formatter
- `bun run typecheck` — TypeScript type checking
