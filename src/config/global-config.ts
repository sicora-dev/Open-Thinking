/**
 * Global configuration management.
 * Stores provider API keys in ~/.openthk/providers.json
 * so they persist across all projects.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Result, err, ok } from "../shared/result";
import { getOpenthkConfigDir } from "./paths";
import { getCatalogProvider, type CatalogProvider } from "./provider-catalog";

function getProvidersFile(): string {
  return join(getOpenthkConfigDir(), "providers.json");
}

export type ProviderEntry = {
  id: string;
  name: string;
  apiKey?: string;
  baseUrl: string;
  type: "openai-compatible" | "ollama" | "custom";
  headers?: Record<string, string>;
  config?: Record<string, string>;
  addedAt: string;
  checkedAt?: string;
};

export type GlobalConfig = {
  providers: Record<string, ProviderEntry>;
};

function ensureConfigDir(): void {
  const configDir = getOpenthkConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

export function loadGlobalConfig(): GlobalConfig {
  ensureConfigDir();
  const providersFile = getProvidersFile();
  if (!existsSync(providersFile)) {
    return { providers: {} };
  }
  try {
    const raw = readFileSync(providersFile, "utf-8");
    return JSON.parse(raw) as GlobalConfig;
  } catch {
    return { providers: {} };
  }
}

export function saveGlobalConfig(config: GlobalConfig): Result<void> {
  try {
    ensureConfigDir();
    writeFileSync(getProvidersFile(), JSON.stringify(config, null, 2), { mode: 0o600 });
    return ok(undefined);
  } catch (e) {
    return err(new Error(`Failed to save config: ${(e as Error).message}`));
  }
}

export function addProvider(entry: ProviderEntry): Result<void> {
  const config = loadGlobalConfig();
  config.providers[entry.id] = entry;
  return saveGlobalConfig(config);
}

export function removeProvider(id: string): Result<boolean> {
  const config = loadGlobalConfig();
  if (!config.providers[id]) {
    return ok(false);
  }
  delete config.providers[id];
  const saveResult = saveGlobalConfig(config);
  if (!saveResult.ok) return saveResult;
  return ok(true);
}

export function getProviderApiKey(id: string): string | null {
  const config = loadGlobalConfig();
  return config.providers[id]?.apiKey ?? null;
}

export function getProviderEntry(id: string): ProviderEntry | null {
  const config = loadGlobalConfig();
  return config.providers[id] ?? null;
}

export function listProviders(): ProviderEntry[] {
  const config = loadGlobalConfig();
  return Object.values(config.providers);
}

export function hasAnyProviders(): boolean {
  const config = loadGlobalConfig();
  return Object.keys(config.providers).length > 0;
}

export function getConfigDir(): string {
  return getOpenthkConfigDir();
}

/**
 * Resolve an API key: first check global config, then env var.
 * Used by the pipeline parser to resolve ${PROVIDER_API_KEY} references.
 */
export function resolveApiKey(providerId: string, envVar?: string): string | null {
  // 1. Check global config
  const globalKey = getProviderApiKey(providerId);
  if (globalKey) return globalKey;

  // 2. Check env var
  if (envVar) {
    const envKey = process.env[envVar] ?? null;
    if (envKey) return envKey;
  }

  return null;
}

export function buildProviderBaseUrl(
  catalog: CatalogProvider,
  values: Record<string, string>,
): string {
  if (catalog.id === "azure") {
    return normalizeAzureBaseUrl(values.baseUrl || values.endpoint || "");
  }

  return trimTrailingSlash(values.baseUrl || catalog.baseUrl);
}

export function providerEntryValues(entry: ProviderEntry | null): Record<string, string> {
  if (!entry) return {};
  return {
    ...(entry.config ?? {}),
    ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
    ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
  };
}

export function resolveProviderConfig(
  providerId: string,
): {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  type: ProviderEntry["type"];
} | null {
  const catalog = getCatalogProvider(providerId);
  const saved = getProviderEntry(providerId);
  if (!catalog && !saved) return null;

  return {
    baseUrl: saved?.baseUrl ?? catalog?.baseUrl ?? "",
    apiKey:
      saved?.apiKey ??
      (catalog?.envVar ? process.env[catalog.envVar] : undefined) ??
      undefined,
    headers: saved?.headers,
    type: saved?.type ?? catalog?.type ?? "openai-compatible",
  };
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizeAzureBaseUrl(value: string): string {
  const baseUrl = trimTrailingSlash(value);
  if (!baseUrl) return "";
  if (baseUrl.includes("/openai/deployments/") && baseUrl.includes("/chat/completions")) {
    return baseUrl;
  }
  if (baseUrl.endsWith("/openai/v1")) return baseUrl;
  if (baseUrl.endsWith("/openai")) return `${baseUrl}/v1`;
  return `${baseUrl}/openai/v1`;
}
