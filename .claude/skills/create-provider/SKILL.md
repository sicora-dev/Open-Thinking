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

type ChatRequest = {
  model: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: ToolDefinition[];
};
```

## Base adapter: OpenAI-compatible

Most providers support the OpenAI chat completions format. The base adapter at `src/providers/adapters/openai-compatible.ts` handles:
- POST `/v1/chat/completions` for chat
- POST `/v1/chat/completions` with `stream: true` for SSE streaming
- GET `/v1/models` for model listing

## Creating a new adapter

1. Check if the provider supports OpenAI-compatible API:
   - **YES** → Extend `OpenAICompatibleAdapter` with just config overrides (base_url, auth headers)
   - **NO** → Implement `LLMProvider` from scratch, translating to/from the provider's native format

2. Place the adapter in `src/providers/adapters/{provider-name}.ts`

3. Handle authentication:
   - API key via `${ENV_VAR}` interpolation from pipeline YAML
   - Bearer token in Authorization header (most providers)
   - Custom auth schemes if needed (document in the adapter)

4. Handle streaming:
   - Parse SSE `data: ` lines
   - Handle `[DONE]` sentinel
   - Yield `StreamChunk` objects with delta content

5. Register in `src/providers/adapters/index.ts` with the provider type string

## Testing

- Create a mock HTTP server for unit tests (use Bun's built-in server)
- Test: successful chat completion, streaming, error handling, auth failure, rate limiting
- Never call real APIs in tests. Use fixtures in `tests/fixtures/providers/`
