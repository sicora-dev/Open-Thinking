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
  supported?: boolean;
  configFields: CatalogProviderField[];
};

export type CatalogProviderField = {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  required: boolean;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: string;
};

const apiKeyField = (envVar: string): CatalogProviderField => ({
  key: "apiKey",
  label: "API key",
  type: "password",
  required: true,
  secret: true,
  placeholder: envVar,
});

const baseUrlField = (baseUrl: string): CatalogProviderField => ({
  key: "baseUrl",
  label: "Base URL",
  type: "url",
  required: true,
  defaultValue: baseUrl,
});

const requiredBaseUrlField = (placeholder: string, help?: string): CatalogProviderField => ({
  key: "baseUrl",
  label: "Base URL",
  type: "url",
  required: true,
  placeholder,
  help,
});

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
    configFields: [apiKeyField("OPENAI_API_KEY")],
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
    configFields: [apiKeyField("ANTHROPIC_API_KEY")],
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
    configFields: [apiKeyField("GOOGLE_API_KEY")],
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
    configFields: [apiKeyField("MISTRAL_API_KEY")],
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
    configFields: [apiKeyField("XAI_API_KEY")],
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
    configFields: [apiKeyField("DEEPSEEK_API_KEY")],
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
    configFields: [apiKeyField("GROQ_API_KEY")],
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
    configFields: [apiKeyField("TOGETHER_API_KEY")],
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
    configFields: [apiKeyField("FIREWORKS_API_KEY")],
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
    configFields: [apiKeyField("OPENROUTER_API_KEY")],
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
    configFields: [apiKeyField("PERPLEXITY_API_KEY")],
  },
  {
    id: "cohere",
    name: "Cohere",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    type: "openai-compatible",
    envVar: "COHERE_API_KEY",
    description: "Command R+, Command R, Embed",
    category: "cloud",
    requiresKey: true,
    signupUrl: "https://dashboard.cohere.com/api-keys",
    configFields: [apiKeyField("COHERE_API_KEY")],
  },

  // ─── Cloud Infrastructure ───────────────────────────────────
  {
    id: "azure",
    name: "Azure OpenAI",
    baseUrl: "https://{resource}.openai.azure.com/openai/v1",
    type: "openai-compatible",
    envVar: "AZURE_OPENAI_API_KEY",
    description: "OpenAI models via Azure — enterprise grade",
    category: "cloud",
    requiresKey: true,
    configFields: [
      requiredBaseUrlField(
        "https://my-resource.openai.azure.com/openai/v1",
        "Use the Azure OpenAI v1 base URL. Stage model names remain configurable per pipeline.",
      ),
      apiKeyField("AZURE_OPENAI_API_KEY"),
    ],
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
    supported: false,
    configFields: [
      { key: "region", label: "Region", type: "text", required: true, placeholder: "us-east-1" },
      {
        key: "accessKeyId",
        label: "Access key ID",
        type: "text",
        required: true,
        secret: true,
        placeholder: "AWS_ACCESS_KEY_ID",
      },
      {
        key: "secretAccessKey",
        label: "Secret access key",
        type: "password",
        required: true,
        secret: true,
        placeholder: "AWS_SECRET_ACCESS_KEY",
      },
      {
        key: "sessionToken",
        label: "Session token",
        type: "password",
        required: false,
        secret: true,
        placeholder: "AWS_SESSION_TOKEN",
      },
    ],
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
    configFields: [baseUrlField("http://localhost:11434")],
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
    configFields: [baseUrlField("http://localhost:1234/v1")],
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
    configFields: [baseUrlField("http://localhost:8080/v1")],
  },
];

export function getCatalogProvider(id: string): CatalogProvider | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}
