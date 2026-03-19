/**
 * Catalog of known LLM providers with their default configuration.
 * Used by the interactive setup wizard to present available providers.
 */

export type CatalogProvider = {
  id: string;
  name: string;
  baseUrl: string;
  type: "openai-compatible" | "ollama" | "custom";
  envVar: string;
  description: string;
  category: "cloud" | "local";
  requiresKey: boolean;
  signupUrl?: string;
};

export const PROVIDER_CATALOG: CatalogProvider[] = [
  // ─── Major Cloud Providers ──────────────────────────────────
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    type: "openai-compatible",
    envVar: "OPENAI_API_KEY",
    description: "GPT-4o, GPT-4.1, o3, o4-mini",
    category: "cloud",
    requiresKey: true,
    signupUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    type: "openai-compatible",
    envVar: "ANTHROPIC_API_KEY",
    description: "Claude Opus 4, Sonnet 4, Haiku 3.5",
    category: "cloud",
    requiresKey: true,
    signupUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    name: "Google AI (Gemini)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    type: "openai-compatible",
    envVar: "GOOGLE_API_KEY",
    description: "Gemini 2.5 Pro, Flash, Gemma",
    category: "cloud",
    requiresKey: true,
    signupUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    type: "openai-compatible",
    envVar: "MISTRAL_API_KEY",
    description: "Mistral Large, Medium, Codestral",
    category: "cloud",
    requiresKey: true,
    signupUrl: "https://console.mistral.ai/api-keys",
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    type: "openai-compatible",
    envVar: "XAI_API_KEY",
    description: "Grok 3, Grok 3 Mini",
    category: "cloud",
    requiresKey: true,
    signupUrl: "https://console.x.ai",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    type: "openai-compatible",
    envVar: "DEEPSEEK_API_KEY",
    description: "DeepSeek V3, DeepSeek R1",
    category: "cloud",
    requiresKey: true,
    signupUrl: "https://platform.deepseek.com/api_keys",
  },

  // ─── Inference Platforms ─────────────────────────────────────
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    type: "openai-compatible",
    envVar: "GROQ_API_KEY",
    description: "Ultra-fast inference — Llama, Mixtral, Gemma",
    category: "cloud",
    requiresKey: true,
    signupUrl: "https://console.groq.com/keys",
  },
  {
    id: "together",
    name: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    type: "openai-compatible",
    envVar: "TOGETHER_API_KEY",
    description: "Open-source models — Llama, Qwen, DeepSeek",
    category: "cloud",
    requiresKey: true,
    signupUrl: "https://api.together.ai/settings/api-keys",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    type: "openai-compatible",
    envVar: "FIREWORKS_API_KEY",
    description: "Fast inference — Llama, Mixtral, custom models",
    category: "cloud",
    requiresKey: true,
    signupUrl: "https://fireworks.ai/api-keys",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    type: "openai-compatible",
    envVar: "OPENROUTER_API_KEY",
    description: "Unified API — access 200+ models from all providers",
    category: "cloud",
    requiresKey: true,
    signupUrl: "https://openrouter.ai/keys",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    type: "openai-compatible",
    envVar: "PERPLEXITY_API_KEY",
    description: "Sonar Pro, Sonar — search-augmented models",
    category: "cloud",
    requiresKey: true,
    signupUrl: "https://www.perplexity.ai/settings/api",
  },
  {
    id: "cohere",
    name: "Cohere",
    baseUrl: "https://api.cohere.com/v2",
    type: "openai-compatible",
    envVar: "COHERE_API_KEY",
    description: "Command R+, Command R, Embed",
    category: "cloud",
    requiresKey: true,
    signupUrl: "https://dashboard.cohere.com/api-keys",
  },

  // ─── Cloud Infrastructure ───────────────────────────────────
  {
    id: "azure",
    name: "Azure OpenAI",
    baseUrl: "https://{resource}.openai.azure.com/openai/deployments/{deployment}",
    type: "openai-compatible",
    envVar: "AZURE_OPENAI_API_KEY",
    description: "OpenAI models via Azure — enterprise grade",
    category: "cloud",
    requiresKey: true,
  },
  {
    id: "bedrock",
    name: "AWS Bedrock",
    baseUrl: "https://bedrock-runtime.{region}.amazonaws.com",
    type: "custom",
    envVar: "AWS_ACCESS_KEY_ID",
    description: "Claude, Llama, Titan via AWS",
    category: "cloud",
    requiresKey: true,
  },

  // ─── Local Inference ────────────────────────────────────────
  {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434",
    type: "ollama",
    envVar: "",
    description: "Local models — Llama, Qwen, Mistral, Gemma",
    category: "local",
    requiresKey: false,
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    type: "openai-compatible",
    envVar: "",
    description: "Local models with GUI — any GGUF model",
    category: "local",
    requiresKey: false,
  },
  {
    id: "llamacpp",
    name: "llama.cpp Server",
    baseUrl: "http://localhost:8080/v1",
    type: "openai-compatible",
    envVar: "",
    description: "Lightweight local inference server",
    category: "local",
    requiresKey: false,
  },
];

export function getCatalogProvider(id: string): CatalogProvider | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}
