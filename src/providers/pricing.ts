/**
 * Model pricing table.
 *
 * Prices are in USD per 1 million tokens (input / output).
 * Source: official provider pricing pages as of May 2026.
 *
 * When `estimateCost` is called with an unknown model, it tries a
 * prefix-based fallback (e.g. "gpt-5.4-mini-2026-01" matches "gpt-5.4-mini").
 * If no match is found at all, it returns `null` — callers MUST handle
 * this and avoid invented numbers in the UI.
 */
import type { TokenUsage } from "../shared/types";

export type ModelPrice = {
  /** USD per 1M input (prompt) tokens. */
  input: number;
  /** USD per 1M output (completion) tokens. */
  output: number;
};

/**
 * Canonical pricing table. Keys are model identifiers as accepted by
 * the provider's API. Aliases are listed explicitly.
 *
 * When a model has dated variants (e.g. "gpt-4o-2024-11-20"), add the
 * base name AND the dated variant — the prefix fallback handles future dates.
 */
const PRICING: Record<string, ModelPrice> = {
  // ── Anthropic ────────────────────────────────────────────
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-opus-4-5-20250520": { input: 5, output: 25 },
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-opus-4-0": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-sonnet-4-0": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  "claude-3-opus-20240229": { input: 15, output: 75 },

  // ── OpenAI — Flagship ────────────────────────────────────
  "gpt-5.5": { input: 5, output: 30 },
  "gpt-5.5-pro": { input: 30, output: 180 },
  "gpt-5.4": { input: 2.5, output: 15 },
  "gpt-5.4-pro": { input: 30, output: 180 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
  "gpt-5.2": { input: 1.75, output: 14 },
  "gpt-5.2-pro": { input: 10.5, output: 84 },
  "gpt-5.1": { input: 1.25, output: 10 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-pro": { input: 2, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },

  // ── OpenAI — Previous Gen ────────────────────────────────
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-2024-11-20": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4": { input: 30, output: 60 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },

  // ── OpenAI — Reasoning (o-series) ────────────────────────
  "o4-mini": { input: 0.55, output: 2.2 },
  "o3": { input: 2, output: 8 },
  "o3-pro": { input: 20, output: 80 },
  "o3-mini": { input: 1.1, output: 4.4 },
  "o1": { input: 15, output: 60 },
  "o1-pro": { input: 150, output: 600 },
  "o1-mini": { input: 3, output: 12 },

  // ── Google (Gemini) ──────────────────────────────────────
  "gemini-3.5-flash": { input: 1.5, output: 9 },
  "gemini-3.1-pro": { input: 2, output: 12 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },

  // ── Mistral — General ────────────────────────────────────
  "mistral-medium-latest": { input: 1.5, output: 7.5 },
  "mistral-large-latest": { input: 0.5, output: 1.5 },
  "mistral-small-latest": { input: 0.1, output: 0.3 },
  "ministral-3b-latest": { input: 0.1, output: 0.1 },
  "ministral-8b-latest": { input: 0.15, output: 0.15 },
  "ministral-14b-latest": { input: 0.2, output: 0.2 },

  // ── Mistral — Coding ─────────────────────────────────────
  "devstral-medium-latest": { input: 0.4, output: 2 },
  "devstral-small-latest": { input: 0.1, output: 0.3 },
  "codestral-latest": { input: 0.3, output: 0.9 },
  "open-mistral-nemo": { input: 0.15, output: 0.15 },

  // ── Mistral — Reasoning ──────────────────────────────────
  "magistral-medium-latest": { input: 2, output: 5 },
  "magistral-small-latest": { input: 0.5, output: 1.5 },

  // ── Mistral — Legacy ─────────────────────────────────────
  "open-mixtral-8x7b": { input: 0.7, output: 0.7 },
  "open-mixtral-8x22b": { input: 2, output: 6 },

  // ── Mistral — Embeddings ─────────────────────────────────
  "mistral-embed": { input: 0.1, output: 0 },
  "codestral-embed": { input: 0.15, output: 0 },

  // ── DeepSeek ─────────────────────────────────────────────
  "deepseek-v4-flash": { input: 0.14, output: 0.28 },
  "deepseek-v4-pro": { input: 0.435, output: 0.87 },
  "deepseek-chat": { input: 0.14, output: 0.28 },
  "deepseek-coder": { input: 0.14, output: 0.28 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },

  // ── xAI (Grok) ──────────────────────────────────────────
  "grok-4.3": { input: 1.25, output: 2.5 },
  "grok-4.20": { input: 1.25, output: 2.5 },
  "grok-build": { input: 1, output: 2 },
  "grok-3": { input: 3, output: 15 },
  "grok-3-mini": { input: 0.3, output: 0.5 },
  "grok-2": { input: 2, output: 10 },
  "grok-2-mini": { input: 0.2, output: 1 },

  // ── Groq (hosted inference) ──────────────────────────────
  "openai/gpt-oss-20b": { input: 0.075, output: 0.3 },
  "openai/gpt-oss-120b": { input: 0.15, output: 0.6 },
  "meta-llama/llama-4-scout-17b-16e-instruct": { input: 0.11, output: 0.34 },
  "qwen/qwen3-32b": { input: 0.29, output: 0.59 },
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },

  // ── Perplexity ───────────────────────────────────────────
  "sonar": { input: 1, output: 1 },
  "sonar-pro": { input: 3, output: 15 },
  "sonar-reasoning-pro": { input: 2, output: 8 },
  "sonar-deep-research": { input: 2, output: 8 },

  // ── Cohere ───────────────────────────────────────────────
  "command-a-plus": { input: 2.5, output: 10 },
  "command-a": { input: 2.5, output: 10 },
  "command-r-plus": { input: 2.5, output: 10 },
  "command-r": { input: 0.5, output: 1.5 },
  "command": { input: 1, output: 2 },
  "command-light": { input: 0.3, output: 0.6 },

  // ── Amazon Bedrock — Nova ────────────────────────────────
  "amazon.nova-micro": { input: 0.035, output: 0.14 },
  "amazon.nova-lite": { input: 0.06, output: 0.24 },
  "amazon.nova-pro": { input: 0.8, output: 3.2 },
  "amazon.nova-premier": { input: 2, output: 8 },

  // ── Amazon Bedrock — Titan ───────────────────────────────
  "amazon.titan-text-express-v1": { input: 0.3, output: 0.9 },
  "amazon.titan-text-lite-v1": { input: 0.15, output: 0.45 },

  // ── Amazon Bedrock — Meta Llama ──────────────────────────
  "meta.llama4-scout-17b-16e-instruct-v1:0": { input: 0.35, output: 1 },
  "meta.llama4-maverick-17b-128e-instruct-v1:0": { input: 0.5, output: 1.5 },
  "meta.llama3-3-70b-instruct-v1:0": { input: 2.65, output: 2.65 },

  // ── Amazon Bedrock — DeepSeek ────────────────────────────
  "deepseek.deepseek-v3-2-0324-v1:0": { input: 0.62, output: 1.85 },

  // Local providers (Ollama, LM Studio, llama.cpp): zero cost.
};

/**
 * Look up the price for a model. Returns `null` if unknown.
 *
 * Tries exact match first, then falls back to the longest prefix match.
 * This handles dated variants (e.g. "gpt-5.4-2026-03-15" → "gpt-5.4")
 * and minor version suffixes without needing every alias.
 */
export function getModelPrice(model: string): ModelPrice | null {
  // Exact match
  const exact = PRICING[model];
  if (exact) return exact;

  // Prefix fallback: find the longest key that is a prefix of the model name.
  // E.g. "gpt-5.4-mini-2026-01" matches "gpt-5.4-mini" (not "gpt-5.4").
  let bestMatch: ModelPrice | null = null;
  let bestLen = 0;
  for (const [key, price] of Object.entries(PRICING)) {
    if (model.startsWith(key) && key.length > bestLen) {
      bestMatch = price;
      bestLen = key.length;
    }
  }
  return bestMatch;
}

/**
 * Estimate cost in USD for a given usage and model.
 * Returns `null` when the model is not in the pricing table.
 *
 * Local providers (ollama, lmstudio, llamacpp) should pass `isLocal: true`
 * to get a zero-cost result instead of `null`.
 */
export function estimateCost(
  usage: TokenUsage,
  model: string,
  isLocal = false,
): number | null {
  if (isLocal) return 0;
  const price = getModelPrice(model);
  if (!price) return null;
  const input = (usage.promptTokens / 1_000_000) * price.input;
  const output = (usage.completionTokens / 1_000_000) * price.output;
  return input + output;
}

/**
 * Format a cost in USD for display. `null` becomes a placeholder.
 */
export function formatCost(cost: number | null): string {
  if (cost === null) return "$—";
  if (cost === 0) return "$0";
  if (cost < 0.0001) return "<$0.0001";
  if (cost < 1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Whether a provider type is fully local (no API cost).
 */
export function isLocalProvider(providerType: string): boolean {
  return providerType === "ollama";
}
