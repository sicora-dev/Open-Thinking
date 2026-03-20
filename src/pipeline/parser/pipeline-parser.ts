/**
 * Pipeline YAML parser.
 * Reads and validates openmind.pipeline.yaml files.
 *
 * Providers in the YAML are declared as a simple list of names:
 *   providers:
 *     - openai
 *     - anthropic
 *     - ollama
 *
 * The parser resolves each name to a full provider config using the
 * provider catalog (base_url, type) and global config (API keys from
 * ~/.openmind/providers.json). Users never need to specify type,
 * base_url, or api_key in the YAML — it's all inferred.
 *
 * For custom providers not in the catalog:
 *   providers:
 *     - openai
 *     - id: my-custom
 *       base_url: https://custom.api.com/v1
 *       api_key: ${MY_KEY}
 */

import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { getCatalogProvider, resolveApiKey } from "../../config";
import { PipelineError } from "../../shared/errors";
import { type Result, err, ok, tryCatchAsync } from "../../shared/result";
import type { PipelineConfig, PipelineMode, ResolvedProvider } from "../../shared/types";

/** Interpolate ${ENV_VAR} references in a string */
const interpolateEnvVars = (value: string): string =>
  value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
    const envValue = typeof Bun !== "undefined" ? Bun.env[varName] : process.env[varName];
    if (!envValue) {
      throw new PipelineError(`Environment variable "${varName}" is not set.`, "PARSE_ERROR", {
        variable: varName,
      });
    }
    return envValue;
  });

/** Recursively interpolate env vars in an object */
const interpolateObject = <T>(obj: T): T => {
  if (typeof obj === "string") return interpolateEnvVars(obj) as T;
  if (Array.isArray(obj)) return obj.map(interpolateObject) as T;
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateObject(value);
    }
    return result as T;
  }
  return obj;
};

/**
 * Resolve the providers list from YAML into a Record<string, ResolvedProvider>.
 *
 * Accepts:
 *   - Array of strings: ["openai", "anthropic"]
 *   - Array of mixed: ["openai", { id: "custom", base_url: "..." }]
 *   - Legacy Record format: { openai: { type: "openai-compatible", base_url: "..." } }
 */
function resolveProviders(
  raw: unknown,
  resolveKeys: boolean,
): Result<Record<string, ResolvedProvider>, PipelineError> {
  if (!raw) {
    return err(new PipelineError("Missing 'providers' section", "VALIDATION_ERROR"));
  }

  const resolved: Record<string, ResolvedProvider> = {};

  // New format: array of provider names/objects
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        // Simple provider name: "openai"
        const catalog = getCatalogProvider(item);
        if (!catalog) {
          return err(
            new PipelineError(
              `Unknown provider "${item}". Use /providers setup to see available providers, or use the object form: { id: "${item}", base_url: "..." }`,
              "VALIDATION_ERROR",
              { provider: item },
            ),
          );
        }

        const apiKey = resolveKeys ? resolveApiKey(catalog.id, catalog.envVar) : undefined;

        resolved[item] = {
          type: catalog.type,
          base_url: catalog.baseUrl,
          api_key: apiKey ?? undefined,
        };
      } else if (typeof item === "object" && item !== null) {
        // Custom provider object: { id: "my-custom", base_url: "..." }
        const obj = item as Record<string, unknown>;
        const id = obj.id as string;
        if (!id) {
          return err(
            new PipelineError("Custom provider entry must have an 'id' field", "VALIDATION_ERROR"),
          );
        }

        // Check if it's a known catalog provider with overrides
        const catalog = getCatalogProvider(id);
        const baseUrl = (obj.base_url as string) ?? catalog?.baseUrl;
        const type = (obj.type as ResolvedProvider["type"]) ?? catalog?.type ?? "openai-compatible";

        if (!baseUrl) {
          return err(
            new PipelineError(`Provider "${id}" requires a 'base_url' field`, "VALIDATION_ERROR", {
              provider: id,
            }),
          );
        }

        let apiKey = obj.api_key as string | undefined;
        if (!apiKey && resolveKeys) {
          apiKey = resolveApiKey(id, catalog?.envVar) ?? undefined;
        }

        resolved[id] = {
          type,
          base_url: baseUrl,
          api_key: apiKey,
          headers: obj.headers as Record<string, string> | undefined,
        };
      }
    }
    return ok(resolved);
  }

  // Legacy format: Record<string, { type, base_url, api_key }>
  if (typeof raw === "object" && raw !== null) {
    for (const [name, config] of Object.entries(raw as Record<string, unknown>)) {
      if (!config || typeof config !== "object") {
        // Bare key with no value: treat as catalog lookup
        const catalog = getCatalogProvider(name);
        if (catalog) {
          const apiKey = resolveKeys ? resolveApiKey(catalog.id, catalog.envVar) : undefined;
          resolved[name] = {
            type: catalog.type,
            base_url: catalog.baseUrl,
            api_key: apiKey ?? undefined,
          };
        } else {
          return err(new PipelineError(`Unknown provider "${name}"`, "VALIDATION_ERROR"));
        }
        continue;
      }

      const cfg = config as Record<string, unknown>;
      resolved[name] = {
        type: (cfg.type as ResolvedProvider["type"]) ?? "openai-compatible",
        base_url: cfg.base_url as string,
        api_key: cfg.api_key as string | undefined,
        headers: cfg.headers as Record<string, string> | undefined,
      };
    }
    return ok(resolved);
  }

  return err(new PipelineError("'providers' must be a list or object", "VALIDATION_ERROR"));
}

/** Validate the parsed config has all required fields */
const validateConfig = (
  config: unknown,
  resolveKeys: boolean,
): Result<PipelineConfig, PipelineError> => {
  const c = config as Record<string, unknown>;

  if (!c.name || typeof c.name !== "string") {
    return err(new PipelineError("Missing or invalid 'name' field", "VALIDATION_ERROR"));
  }

  if (!c.version || typeof c.version !== "string") {
    return err(new PipelineError("Missing or invalid 'version' field", "VALIDATION_ERROR"));
  }

  // Resolve providers from catalog
  const providersResult = resolveProviders(c.providers, resolveKeys);
  if (!providersResult.ok) return providersResult;

  if (!c.stages || typeof c.stages !== "object") {
    return err(new PipelineError("Missing or invalid 'stages' section", "VALIDATION_ERROR"));
  }

  // Validate each stage references a valid provider
  const providerNames = Object.keys(providersResult.value);
  const stages = c.stages as Record<string, Record<string, unknown>>;

  for (const [stageName, stage] of Object.entries(stages)) {
    if (!stage.provider || !providerNames.includes(stage.provider as string)) {
      return err(
        new PipelineError(
          `Stage "${stageName}" references unknown provider "${stage.provider}". Available: ${providerNames.join(", ")}`,
          "VALIDATION_ERROR",
          { stageName, provider: stage.provider },
        ),
      );
    }

    if (!stage.model || typeof stage.model !== "string") {
      return err(
        new PipelineError(`Stage "${stageName}" is missing 'model' field`, "VALIDATION_ERROR", {
          stageName,
        }),
      );
    }

    // Validate depends_on references
    if (stage.depends_on && Array.isArray(stage.depends_on)) {
      const stageNames = Object.keys(stages);
      for (const dep of stage.depends_on as string[]) {
        if (!stageNames.includes(dep)) {
          return err(
            new PipelineError(
              `Stage "${stageName}" depends on unknown stage "${dep}"`,
              "VALIDATION_ERROR",
              { stageName, dependency: dep },
            ),
          );
        }
      }
    }
  }

  // Validate mode
  const mode: PipelineMode = (c.mode as PipelineMode) ?? "sequential";
  if (mode !== "sequential" && mode !== "orchestrated") {
    return err(
      new PipelineError(
        `Invalid mode "${c.mode}". Must be "sequential" or "orchestrated".`,
        "VALIDATION_ERROR",
      ),
    );
  }

  // Validate orchestrated mode constraints
  if (mode === "orchestrated") {
    const orchestrators = Object.entries(stages).filter(
      ([, s]) => s.role === "orchestrator",
    );
    if (orchestrators.length === 0) {
      return err(
        new PipelineError(
          'Orchestrated mode requires exactly one stage with role: "orchestrator".',
          "VALIDATION_ERROR",
        ),
      );
    }
    if (orchestrators.length > 1) {
      const names = orchestrators.map(([n]) => n).join(", ");
      return err(
        new PipelineError(
          `Orchestrated mode allows only one orchestrator. Found: ${names}`,
          "VALIDATION_ERROR",
        ),
      );
    }
  }

  // Validate role field on stages
  for (const [stageName, stage] of Object.entries(stages)) {
    if (stage.role && stage.role !== "orchestrator") {
      return err(
        new PipelineError(
          `Stage "${stageName}" has invalid role "${stage.role}". Only "orchestrator" is supported.`,
          "VALIDATION_ERROR",
          { stageName },
        ),
      );
    }
    if (stage.role === "orchestrator" && mode !== "orchestrated") {
      return err(
        new PipelineError(
          `Stage "${stageName}" has role "orchestrator" but pipeline mode is "${mode}". Set mode: orchestrated.`,
          "VALIDATION_ERROR",
          { stageName },
        ),
      );
    }
  }

  // Detect circular dependencies (only relevant for sequential mode)
  if (mode === "sequential") {
    const circularCheck = detectCircularDeps(stages);
    if (!circularCheck.ok) return circularCheck;
  }

  // Build final config with resolved providers
  const finalConfig: PipelineConfig = {
    name: c.name as string,
    version: c.version as string,
    mode,
    context: (c.context as PipelineConfig["context"]) ?? {
      backend: "sqlite",
      vector: "embedded",
      ttl: "7d",
    },
    providers: providersResult.value,
    stages: c.stages as PipelineConfig["stages"],
    policies: (c.policies as PipelineConfig["policies"]) ?? { global: {} },
  };

  return ok(finalConfig);
};

/** Detect circular dependencies in stage DAG */
const detectCircularDeps = (
  stages: Record<string, Record<string, unknown>>,
): Result<void, PipelineError> => {
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (name: string): boolean => {
    if (visiting.has(name)) return true; // cycle!
    if (visited.has(name)) return false;

    visiting.add(name);
    const deps = (stages[name]?.depends_on as string[]) ?? [];
    for (const dep of deps) {
      if (visit(dep)) return true;
    }
    visiting.delete(name);
    visited.add(name);
    return false;
  };

  for (const name of Object.keys(stages)) {
    if (visit(name)) {
      return err(
        new PipelineError(
          `Circular dependency detected involving stage "${name}"`,
          "VALIDATION_ERROR",
          { stageName: name },
        ),
      );
    }
  }

  return ok(undefined);
};

/**
 * Parse a pipeline YAML file.
 *
 * @param filePath - Path to the YAML file
 * @param resolveKeys - Whether to resolve API keys from global config (default: true).
 *                      Set to false for validation-only (e.g., `openmind validate`).
 */
export const parsePipeline = async (
  filePath: string,
  resolveKeys = true,
): Promise<Result<PipelineConfig, PipelineError>> => {
  // Read file
  const fileResult = await tryCatchAsync(() => readFile(filePath, "utf-8"));
  if (!fileResult.ok) {
    return err(
      new PipelineError(`Cannot read pipeline file: ${filePath}`, "PARSE_ERROR", {
        path: filePath,
        cause: fileResult.error.message,
      }),
    );
  }

  // Parse YAML
  let parsed: unknown;
  try {
    parsed = parseYaml(fileResult.value);
  } catch (e) {
    return err(
      new PipelineError(
        `Invalid YAML syntax: ${e instanceof Error ? e.message : String(e)}`,
        "PARSE_ERROR",
      ),
    );
  }

  // Interpolate env vars (only in string values, e.g., custom api_key: ${MY_KEY})
  if (resolveKeys) {
    try {
      parsed = interpolateObject(parsed);
    } catch (e) {
      if (e instanceof PipelineError) return err(e);
      return err(
        new PipelineError(
          `Environment variable interpolation failed: ${e instanceof Error ? e.message : String(e)}`,
          "PARSE_ERROR",
        ),
      );
    }
  }

  // Validate and resolve
  return validateConfig(parsed, resolveKeys);
};

export const parsePipelineFromString = (
  yamlContent: string,
  resolveKeys = false,
): Result<PipelineConfig, PipelineError> => {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlContent);
  } catch (e) {
    return err(
      new PipelineError(
        `Invalid YAML syntax: ${e instanceof Error ? e.message : String(e)}`,
        "PARSE_ERROR",
      ),
    );
  }

  if (resolveKeys) {
    try {
      parsed = interpolateObject(parsed);
    } catch (e) {
      if (e instanceof PipelineError) return err(e);
      return err(
        new PipelineError(
          `Env interpolation failed: ${e instanceof Error ? e.message : String(e)}`,
          "PARSE_ERROR",
        ),
      );
    }
  }

  return validateConfig(parsed, resolveKeys);
};
