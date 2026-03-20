export {
  // Types
  type PipelineOrigin,
  type PipelineEntry,
  type UserPreferences,
  type StageContext,
  // Paths
  getGlobalDir,
  getProjectDir,
  // Initialization
  ensureGlobalWorkspace,
  initProjectWorkspace,
  hasProjectWorkspace,
  // Reading context
  readUserPreferences,
  readProjectSoul,
  readStageInstructions,
  readLearned,
  readRecentHistory,
  // Writing context
  writeHistoryEntry,
  writeLearned,
  writeProjectSoul,
  // Purging
  purgeOldHistory,
  // Context assembly
  loadStageContext,
  formatPersistentContext,
  // Pipeline registry
  pipelineNameFromFilename,
  listAvailablePipelines,
  getActivePipelineName,
  setActivePipeline,
  findPipelineConflicts,
  resolvePipelinePath,
  // User preferences
  loadUserPreferences,
  saveUserPreferences,
  getPipelineDefault,
  setPipelineDefault,
  clearPipelineDefault,
} from "./workspace";
