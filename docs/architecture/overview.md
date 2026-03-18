# OpenMind Architecture Overview

## Core Concepts

### Pipeline
A pipeline is a YAML-defined sequence of stages. Each stage uses a specific LLM provider/model and has defined context permissions. Stages form a DAG (Directed Acyclic Graph) via `depends_on`.

### Stage
A single step in a pipeline. Receives context from previous stages, calls an LLM with a skill prompt, and writes results to the context store.

### Provider
An abstraction over LLM APIs. All providers implement the `LLMProvider` interface. The base adapter supports any OpenAI-compatible API, with specific adapters for Anthropic, Ollama, and custom endpoints.

### Context Store
A namespaced key-value store shared between stages. Keys use dot notation (`plan.architecture`, `code.files`). Each stage can only read/write keys matching its declared permissions.

### Skill
A reusable package that defines how an LLM should behave. Contains a system prompt template, optional tool definitions, and a manifest with metadata. Skills are the unit of sharing between teams.

### Policy
Declarative rules that control what each stage can do. Enforced at the context layer (read/write permissions) and at the provider layer (rate limits, cost limits).

## Data Flow

```
                    ┌─────────────────┐
 User Input ───────►│  Pipeline YAML  │
                    │  Parser         │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  DAG Resolver   │──── Determines execution order
                    └────────┬────────┘
                             │
              ┌──────────────▼──────────────┐
              │     Stage Executor          │
              │                             │
              │  For each stage:            │
              │  1. Load skill              │
              │  2. Read context (policy)   │
              │  3. Call LLM provider       │
              │  4. Write context (policy)  │
              │  5. Emit events             │
              └──────────────┬──────────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
   ┌────────▼───────┐ ┌─────▼──────┐ ┌───────▼──────┐
   │ Context Store  │ │ Event Bus  │ │ Audit Log    │
   │ (SQLite)       │ │            │ │              │
   └────────────────┘ └────────────┘ └──────────────┘
```

## Key Design Decisions

### 1. Result<T, E> over exceptions
All core functions return `Result<T, E>` instead of throwing. This makes error handling explicit, composable, and testable. Exceptions are only caught at the CLI boundary.

### 2. OpenAI-compatible as base protocol
Instead of building N adapters from scratch, the base adapter speaks the OpenAI chat completions format. Most providers (Anthropic, Google, Mistral, Ollama) either support it natively or can be adapted with minimal header/body transformations.

### 3. Skills as prompt templates (v1)
In v1, skills are plain TypeScript modules: a prompt template + optional tool functions. This is simpler to build and test than WASM sandboxing. WASM runtime is planned for v2 when the skill ecosystem needs stronger isolation.

### 4. SQLite for local, PostgreSQL for teams
Solo developers get zero-config SQLite. Teams needing shared state deploy a PostgreSQL instance. The `ContextStore` interface abstracts the backend, and the pipeline YAML specifies which one to use.

### 5. Events, not callbacks
Stages communicate through a typed event bus, not direct callbacks. This decouples the execution engine from the CLI UI, the dashboard, and the audit log. Each consumer subscribes to the events it cares about.

## Module Dependency Graph

```
shared (types, result, errors, logger)
  ↑
  ├── pipeline/parser
  ├── providers/adapters
  ├── context/store
  ├── policies/engine
  ├── skills/runtime
  ├── core/events
  │     ↑
  │     └── core/engine (orchestrates everything)
  │           ↑
  │           └── cli/commands (user-facing)
  └── dashboard (Phase 3)
```

No circular dependencies. `shared` depends on nothing. Each module depends only on `shared` and optionally on sibling modules. The `core/engine` is the integration point.
