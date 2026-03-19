---
name: create-provider
description: Create or modify LLM provider adapters. Use when adding support for a new LLM provider (Anthropic, OpenAI, Ollama, Google, custom endpoints, etc.) or fixing provider-related issues.
allowed-tools: Read, Write, Bash(bun:*), Grep, Glob, WebFetch
---

When creating or modifying a provider adapter:

## Architecture

All providers implement the `LLMProvider` interface:

```typescript
type LLMProvider = {
  name: string;
  chat(request: ChatRequest): Promise<Result<ChatResponse>>;
  stream(request: ChatRequest): AsyncGenerator<StreamChunk>;
  listModels(): Promise<Result<ModelInfo[]>>;
  healthCheck(): Promise<Result<boolean>>;
};
```

## Provider Resolution

Providers in the pipeline YAML are just names (e.g., `- openai`). The parser resolves them to a `ResolvedProvider` using:

1. **Provider catalog** (`src/config/provider-catalog.ts`): contains `baseUrl`, `type`, `envVar` for 18+ providers
2. **Global config** (`~/.openmind/providers.json`): API keys stored via `/providers setup`

```typescript
type ResolvedProvider = {
  type: "openai-compatible" | "ollama" | "custom";
  base_url: string;
  api_key?: string;
  headers?: Record<string, string>;
};
```

Users do NOT specify `type`, `base_url`, or `api_key` in the YAML for known providers.

## Base adapter: OpenAI-compatible

Most providers support the OpenAI chat completions format. The base adapter at `src/providers/adapters/openai-compatible-adapter.ts` handles:
- POST `/chat/completions` for chat
- POST `/chat/completions` with `stream: true` for SSE streaming
- GET `/models` for model listing

## Creating a new adapter

1. Check if the provider supports OpenAI-compatible API:
   - **YES** → Just add it to `src/config/provider-catalog.ts` with the right `baseUrl`. No new adapter code needed.
   - **Partially** → Extend `OpenAICompatibleAdapter` with translation (like `anthropic-adapter.ts`)
   - **NO** → Implement `LLMProvider` from scratch

2. If a new adapter file is needed, place it in `src/providers/adapters/{provider-name}-adapter.ts`

3. Add provider detection in `src/providers/adapters/provider-factory.ts` (switch on `config.type` or check `config.base_url`)

4. Always add the provider to `src/config/provider-catalog.ts` so users can configure it via `/providers setup`

## Adding a new catalog provider

Most new providers just need an entry in `src/config/provider-catalog.ts`:

```typescript
{
  id: "new-provider",
  name: "New Provider",
  baseUrl: "https://api.newprovider.com/v1",
  type: "openai-compatible",
  envVar: "NEW_PROVIDER_API_KEY",
  description: "Models available from this provider",
  category: "cloud",
  requiresKey: true,
  signupUrl: "https://newprovider.com/api-keys",
}
```

No YAML changes, no adapter code, no env var setup needed. The provider catalog + global config handle everything.

## Testing

- Create a mock HTTP server for unit tests (use Bun's built-in server)
- Test: successful chat completion, streaming, error handling, auth failure, rate limiting
- Never call real APIs in tests. Use fixtures in `tests/fixtures/providers/`
