export type UiTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "openthk.ui.theme";

export function isUiTheme(value: string | null): value is UiTheme {
  return value === "dark" || value === "light";
}

export function resolveInitialTheme(): UiTheme {
  if (typeof window === "undefined") return "dark";

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (isUiTheme(stored)) return stored;

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: UiTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
