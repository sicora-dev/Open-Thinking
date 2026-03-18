/**
 * Pipeline YAML parser.
 * Reads and validates openmind.pipeline.yaml files.
 */

import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { PipelineError } from "../../shared/errors";
import { type Result, err, ok, tryCatchAsync } from "../../shared/result";
import type { PipelineConfig } from "../../shared/types";

/** Interpolate ${ENV_VAR} references in strings */
const interpolateEnvVars = (value: string): string =>
  value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
    const envValue = typeof Bun !== "undefined" ? Bun.env[varName] : process.env[varName];
    if (!envValue) {
      throw new PipelineError(`Environment variable "${varName}" is not set`, "PARSE_ERROR", {
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

/** Validate the parsed config has all required fields */
const validateConfig = (config: unknown): Result<PipelineConfig, PipelineError> => {
  const c = config as Record<string, unknown>;

  if (!c.name || typeof c.name !== "string") {
    return err(new PipelineError("Missing or invalid 'name' field", "VALIDATION_ERROR"));
  }

  if (!c.version || typeof c.version !== "string") {
    return err(new PipelineError("Missing or invalid 'version' field", "VALIDATION_ERROR"));
  }

  if (!c.providers || typeof c.providers !== "object") {
    return err(new PipelineError("Missing or invalid 'providers' section", "VALIDATION_ERROR"));
  }

  if (!c.stages || typeof c.stages !== "object") {
    return err(new PipelineError("Missing or invalid 'stages' section", "VALIDATION_ERROR"));
  }

  // Validate each stage references a valid provider
  const providerNames = Object.keys(c.providers as Record<string, unknown>);
  const stages = c.stages as Record<string, Record<string, unknown>>;

  for (const [stageName, stage] of Object.entries(stages)) {
    if (!stage.provider || !providerNames.includes(stage.provider as string)) {
      return err(
        new PipelineError(
          `Stage "${stageName}" references unknown provider "${stage.provider}"`,
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

  // Detect circular dependencies
  const circularCheck = detectCircularDeps(stages);
  if (!circularCheck.ok) return circularCheck;

  return ok(config as PipelineConfig);
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
 * @param interpolateEnv - Whether to interpolate env vars (default: true).
 *                         Set to false for validation-only (e.g., `openmind validate`).
 */
export const parsePipeline = async (
  filePath: string,
  interpolateEnv = true,
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

  // Interpolate env vars
  if (interpolateEnv) {
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

  // Validate
  return validateConfig(parsed);
};

export const parsePipelineFromString = (
  yamlContent: string,
  interpolateEnv = false,
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

  if (interpolateEnv) {
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

  return validateConfig(parsed);
};
