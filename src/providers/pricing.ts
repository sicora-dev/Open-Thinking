/**
 * Model pricing table.
 *
 * Prices are in USD per 1 million tokens (input / output).
 * Source: official provider pricing pages as of 2025.
 *
 * When `estimateCost` is called with an unknown model, it returns `null`
 * — callers MUST handle this and avoid invented numbers in the UI.
 *
 * Maintenance: keep this table small and explicit. Do not auto-fallback
 * by family/prefix without an explicit entry — that hides pricing changes.
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
 */
const PRICING: Record<string, ModelPrice> = {
  // ── Anthropic ────────────────────────────────────────────
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-opus-4-5-20250520": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  "claude-3-opus-20240229": { input: 15, output: 75 },

  // ── OpenAI ───────────────────────────────────────────────
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-2024-11-20": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4": { input: 30, output: 60 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "o1": { input: 15, output: 60 },
  "o1-mini": { input: 3, output: 12 },
  "o3-mini": { input: 1.1, output: 4.4 },

  // ── Google ───────────────────────────────────────────────
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },

  // ── Mistral ──────────────────────────────────────────────
  "mistral-large-latest": { input: 2, output: 6 },
  "mistral-small-latest": { input: 0.2, output: 0.6 },

  // ── DeepSeek ─────────────────────────────────────────────
  "deepseek-chat": { input: 0.27, output: 1.1 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },

  // ── xAI ──────────────────────────────────────────────────
  "grok-2": { input: 2, output: 10 },
  "grok-2-mini": { input: 0.2, output: 1 },

  // ── Groq (hosted, very low) ──────────────────────────────
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },

  // Local providers (Ollama, LM Studio, llama.cpp): zero cost.
};

/**
 * Look up the price for a model. Returns `null` if unknown.
 *
 * Lookup is exact-match. Callers should NOT fall back to a "default" price
 * — it is far better to display "$—" in the UI than an invented number.
 */
export function getModelPrice(model: string): ModelPrice | null {
  return PRICING[model] ?? null;
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
