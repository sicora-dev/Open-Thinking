const SELECTED_WORKSPACE_PROJECT_KEY = "openthk:selected-workspace-project-id";
export const SELECTED_WORKSPACE_CHANGE_EVENT = "openthk:selected-workspace-change";

type WorkspaceProject = {
  id: string;
};

export function readSelectedWorkspaceProjectId(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(SELECTED_WORKSPACE_PROJECT_KEY) ?? "";
}

export function writeSelectedWorkspaceProjectId(projectId: string | null): void {
  if (typeof window === "undefined") return;
  if (projectId) window.localStorage.setItem(SELECTED_WORKSPACE_PROJECT_KEY, projectId);
  else window.localStorage.removeItem(SELECTED_WORKSPACE_PROJECT_KEY);
  window.dispatchEvent(new Event(SELECTED_WORKSPACE_CHANGE_EVENT));
}

export function resolveSelectedWorkspaceProjectId(
  projects: WorkspaceProject[],
  preferredProjectId?: string | null,
): string {
  if (preferredProjectId && projects.some((project) => project.id === preferredProjectId)) {
    return preferredProjectId;
  }

  const storedProjectId = readSelectedWorkspaceProjectId();
  if (storedProjectId && projects.some((project) => project.id === storedProjectId)) {
    return storedProjectId;
  }

  return projects.length === 1 ? projects[0].id : "";
}
