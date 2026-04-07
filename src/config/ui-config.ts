/**
 * UI-related preferences (autostart, etc.) stored in ~/.openthk/config.json.
 * Kept separate from providers.json so the two evolve independently.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Result, err, ok } from "../shared/result";
import { getOpenthkConfigDir } from "./paths";

function getConfigFile(): string {
  return join(getOpenthkConfigDir(), "config.json");
}

export type OpenthkConfig = {
  ui?: {
    /** undefined = ask on next run, true = silently start, false = never */
    autostart?: boolean;
  };
};

function ensureDir(): void {
  const configDir = getOpenthkConfigDir();
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
}

export function loadOpenthkConfig(): OpenthkConfig {
  const configFile = getConfigFile();
  if (!existsSync(configFile)) return {};
  try {
    return JSON.parse(readFileSync(configFile, "utf-8")) as OpenthkConfig;
  } catch {
    return {};
  }
}

export function saveOpenthkConfig(cfg: OpenthkConfig): Result<void> {
  try {
    ensureDir();
    writeFileSync(getConfigFile(), JSON.stringify(cfg, null, 2));
    return ok(undefined);
  } catch (e) {
    return err(new Error(`Failed to save config: ${(e as Error).message}`));
  }
}

export function getUiAutostart(): boolean | undefined {
  return loadOpenthkConfig().ui?.autostart;
}

export function setUiAutostart(value: boolean): Result<void> {
  const cfg = loadOpenthkConfig();
  cfg.ui = { ...(cfg.ui ?? {}), autostart: value };
  return saveOpenthkConfig(cfg);
}
