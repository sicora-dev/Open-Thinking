# OpenMind

**Open-source AI pipeline orchestrator for development teams.**

Define pipelines where multiple LLMs collaborate on tasks with shared context, access policies, and reusable skills.

```yaml
# openmind.pipeline.yaml
stages:
  planning:
    provider: anthropic
    model: claude-opus-4-5-20250520
    skill: openmind/arch-planner@1.0

  develop:
    provider: moonshot
    model: kimi-k2-0711
    skill: openmind/code-writer@1.0
    depends_on: [planning]

  testing:
    provider: anthropic
    model: claude-sonnet-4-20250514
    skill: openmind/test-gen@1.0
    depends_on: [develop]
```

## Features

- **Multi-LLM orchestration** — Assign different models to different stages. Opus plans, Kimi codes, Sonnet tests.
- **Shared context** — Stages read and write to a shared context store. Context flows automatically between stages.
- **Access policies** — Each stage declares what it can read/write. The policy engine enforces it.
- **Reusable skills** — Package prompts + tools as skills. Install from registry or create your own.
- **Any provider** — OpenAI, Anthropic, Google, Ollama, or any OpenAI-compatible endpoint.

## Quick Start

```bash
# Install
bun install -g openmind

# Initialize a project
openmind init my-project
cd my-project

# Configure a provider
openmind provider add anthropic --key $ANTHROPIC_API_KEY

# Run a pipeline
openmind run --pipeline feature-development --input "Build a REST API for user management"
```

## Development

```bash
# Clone and install
git clone https://github.com/your-org/openmind
cd openmind
bun install

# Run in dev mode
bun run dev -- run --pipeline feature-development

# Run tests
bun test

# Build binary
bun run build
```

## Architecture

See [docs/architecture/overview.md](docs/architecture/overview.md) for the full architecture guide.

## Status

**Phase 1 — Core Engine** (in progress)

- [x] Project scaffold
- [x] Type system and error handling
- [x] Pipeline YAML parser
- [x] Event bus
- [ ] Provider adapters (OpenAI-compatible, Anthropic, Ollama)
- [ ] Context store (SQLite)
- [ ] Policy engine
- [ ] Stage executor
- [ ] CLI commands (init, run, validate, provider, context)

## License

MIT
