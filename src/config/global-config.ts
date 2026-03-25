/**
 * Global configuration management.
 * Stores provider API keys in ~/.openthk/providers.json
 * so they persist across all projects.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Result, err, ok } from "../shared/result";

const CONFIG_DIR = join(homedir(), ".openthk");
const PROVIDERS_FILE = join(CONFIG_DIR, "providers.json");

export type ProviderEntry = {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  type: "openai-compatible" | "ollama" | "custom";
  addedAt: string;
};

export type GlobalConfig = {
  providers: Record<string, ProviderEntry>;
};

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadGlobalConfig(): GlobalConfig {
  ensureConfigDir();
  if (!existsSync(PROVIDERS_FILE)) {
    return { providers: {} };
  }
  try {
    const raw = readFileSync(PROVIDERS_FILE, "utf-8");
    return JSON.parse(raw) as GlobalConfig;
  } catch {
    return { providers: {} };
  }
}

export function saveGlobalConfig(config: GlobalConfig): Result<void> {
  try {
    ensureConfigDir();
    writeFileSync(PROVIDERS_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
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

export function listProviders(): ProviderEntry[] {
  const config = loadGlobalConfig();
  return Object.values(config.providers);
}

export function hasAnyProviders(): boolean {
  const config = loadGlobalConfig();
  return Object.keys(config.providers).length > 0;
}

export function getConfigDir(): string {
  return CONFIG_DIR;
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
