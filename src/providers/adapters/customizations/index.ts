/**
 * Provider protocol registry.
 *
 * Maps provider names (as declared in the provider catalog) to their
 * protocol implementation. Providers not listed here use the default
 * protocol (standard OpenAI-compatible API).
 *
 * To add a new provider:
 * 1. Create a file in this directory (e.g., `mistral.ts`)
 * 2. Export a ProviderProtocol that extends or replaces the default
 * 3. Register it in this map
 */

import type { ProviderProtocol } from "../provider-protocol";
import { anthropicProtocol } from "./anthropic";
import { defaultProtocol } from "./default";
import { ollamaProtocol } from "./ollama";
import { openaiProtocol } from "./openai";

const protocolRegistry: Record<string, ProviderProtocol> = {
  openai: openaiProtocol,
  anthropic: anthropicProtocol,
  ollama: ollamaProtocol,
};

/**
 * Get the protocol for a provider by name.
 * Returns the default (OpenAI-compatible) protocol if no specific one is registered.
 */
export function getProtocol(providerName: string): ProviderProtocol {
  return protocolRegistry[providerName] ?? defaultProtocol;
}

export { defaultProtocol } from "./default";
export { openaiProtocol } from "./openai";
export { anthropicProtocol } from "./anthropic";
export { ollamaProtocol } from "./ollama";
