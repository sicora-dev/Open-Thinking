import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parsePipeline } from "../../pipeline/parser";
import type { PipelineConfig } from "../../shared/types";
import {
  getActivePipelineName,
  hasProjectWorkspace,
  initProjectWorkspace,
  listAvailablePipelines,
  purgeOldHistory,
  resolvePipelinePath,
  setActivePipeline,
} from "../../workspace";

export type WorkspaceSessionState = {
  workingDir: string;
  pipelineConfig: PipelineConfig | null;
  pipelinePath: string | null;
  skillsDir: string | null;
};

async function resolvePipelineForWorkspace(
  workingDir: string,
): Promise<Pick<WorkspaceSessionState, "pipelineConfig" | "pipelinePath">> {
  const activeName = getActivePipelineName(workingDir);
  if (activeName) {
    const resolved = resolvePipelinePath(workingDir, activeName);
    if (resolved && !("conflict" in resolved)) {
      const result = await parsePipeline(resolved.path);
      if (result.ok) {
        return { pipelineConfig: result.value, pipelinePath: resolved.path };
      }
    }
  }

  const available = listAvailablePipelines(workingDir);
  const projectPipelines = available.filter((pipeline) => pipeline.origin === "project");
  const userPipelines = available.filter((pipeline) => pipeline.origin === "user");

  // Prefer project-local registered pipelines over global ones.
  if (projectPipelines.length === 1) {
    const entry = projectPipelines[0]!;
    const result = await parsePipeline(entry.path);
    if (result.ok) {
      setActivePipeline(workingDir, entry.name);
      return { pipelineConfig: result.value, pipelinePath: entry.path };
    }
  }

  // If there are multiple registered project pipelines, require explicit choice.
  if (projectPipelines.length > 1) {
    return { pipelineConfig: null, pipelinePath: null };
  }

  const candidates = [
    "openthk.pipeline.yaml",
    "openthk.pipeline.yml",
    "pipeline.yaml",
    "pipeline.yml",
  ];

  for (const candidate of candidates) {
    const filePath = resolve(workingDir, candidate);
    if (!existsSync(filePath)) continue;
    const result = await parsePipeline(filePath);
    if (result.ok) {
      return { pipelineConfig: result.value, pipelinePath: filePath };
    }
  }

  if (userPipelines.length === 1) {
    const entry = userPipelines[0]!;
    const result = await parsePipeline(entry.path);
    if (result.ok) {
      setActivePipeline(workingDir, entry.name);
      return { pipelineConfig: result.value, pipelinePath: entry.path };
    }
  }

  return { pipelineConfig: null, pipelinePath: null };
}

export async function loadWorkspaceSessionState(
  workingDir: string,
): Promise<WorkspaceSessionState> {
  const resolvedWorkingDir = resolve(workingDir);
  const detected = await resolvePipelineForWorkspace(resolvedWorkingDir);

  if (detected.pipelineConfig && !hasProjectWorkspace(resolvedWorkingDir)) {
    initProjectWorkspace(resolvedWorkingDir);
  }

  if (hasProjectWorkspace(resolvedWorkingDir)) {
    purgeOldHistory(resolvedWorkingDir);
  }

  return {
    workingDir: resolvedWorkingDir,
    pipelineConfig: detected.pipelineConfig,
    pipelinePath: detected.pipelinePath,
    skillsDir: null,
  };
}
