import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  resolveInitialTheme,
  type UiTheme,
} from "../lib/theme";
import { Icons } from "./Icons";
import { Logomark } from "./Logomark";

type NavGroup = {
  group: string;
  items: {
    id: string;
    label: string;
    href: string;
    icon: ReactNode;
    count?: number;
    kbd?: string;
  }[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    group: "Workspace",
    items: [
      { id: "dashboard", label: "Dashboard", href: "#/dashboard", icon: Icons.home },
      { id: "run", label: "Run pipeline", href: "#/run", icon: Icons.play, kbd: "R" },
      { id: "pipelines", label: "Pipelines", href: "#/pipelines", icon: Icons.flow },
      { id: "history", label: "History", href: "#/runs", icon: Icons.clock },
    ],
  },
  {
    group: "Resources",
    items: [
      { id: "providers", label: "Providers", href: "#/providers", icon: Icons.plug },
      { id: "skills", label: "Skills", href: "#/skills", icon: Icons.skill },
      { id: "context", label: "Context store", href: "#/context", icon: Icons.db },
      { id: "files", label: "Workspace files", href: "#/files", icon: Icons.folder },
    ],
  },
  {
    group: "System",
    items: [
      { id: "logs", label: "Logs", href: "#/logs", icon: Icons.terminal },
      { id: "settings", label: "Settings", href: "#/settings", icon: Icons.settings },
    ],
  },
];

const LABELS: Record<string, string> = {};
for (const g of NAV_GROUPS) {
  for (const item of g.items) {
    LABELS[item.id] = item.label;
  }
}

type LayoutProps = {
  active: string;
  children: ReactNode;
  onOpenPalette?: () => void;
};

export function Layout({ active, children, onOpenPalette }: LayoutProps) {
  const [version, setVersion] = useState<string | null>(null);
  const [theme, setTheme] = useState<UiTheme>(resolveInitialTheme);

  useEffect(() => {
    api.health().then((h) => setVersion(h.version)).catch(() => {});
  }, []);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const isActive = (id: string) =>
    active === id ||
    (id === "history" && (active === "runs" || active === "run")) ||
    (id === "pipelines" && active === "pipelineEditor");

  const activeLabel = LABELS[active] ?? "Dashboard";
  const project = "feature-development";

  return (
    <div
      style={{
        fontFamily: "var(--font-sans)",
        color: "var(--fg)",
        background: "var(--bg)",
        fontSize: 14,
        lineHeight: 1.5,
        WebkitFontSmoothing: "antialiased",
        letterSpacing: "-0.003em",
        width: "100%",
        height: "100%",
        display: "flex",
        overflow: "hidden",
      }}
    >
      {/* Sidebar */}
      <aside
        style={{
          width: 232,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--bg-soft)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Brand + project */}
        <div style={{ padding: "16px 14px 10px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 14,
              padding: "2px 4px",
            }}
          >
            <Logomark size={22} />
            <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.2 }}>
              Open<span style={{ color: "var(--cyan-500)" }}>Thinking</span>
            </span>
          </div>

          {/* Project selector */}
          <button
            type="button"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 10px",
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              cursor: "pointer",
              fontSize: 13,
              color: "var(--fg)",
              textAlign: "left",
              fontFamily: "inherit",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: "var(--cyan-500)",
              }}
            />
            <div
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.2 }}>
                Project
              </div>
              <div style={{ fontWeight: 500, lineHeight: 1.3 }}>{project}</div>
            </div>
            <span style={{ color: "var(--fg-dim)" }}>{Icons.chevDown}</span>
          </button>
        </div>

        {/* Command palette trigger */}
        <div style={{ padding: "0 14px 14px" }}>
          <button
            type="button"
            onClick={onOpenPalette}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              cursor: "pointer",
              fontSize: 12.5,
              color: "var(--fg-muted)",
              fontFamily: "inherit",
            }}
          >
            <span style={{ color: "var(--fg-dim)" }}>{Icons.search}</span>
            <span style={{ flex: 1, textAlign: "left" }}>Search or run</span>
            <span
              className="mono"
              style={{
                fontSize: 10.5,
                padding: "1px 5px",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 3,
                color: "var(--fg-dim)",
              }}
            >
              ⌘K
            </span>
          </button>
        </div>

        {/* Nav groups */}
        <nav
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 8px 12px",
          }}
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.group} style={{ marginBottom: 14 }}>
              <div
                style={{
                  padding: "4px 10px 6px",
                  fontSize: 10.5,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  color: "var(--fg-dim)",
                  fontWeight: 600,
                }}
              >
                {group.group}
              </div>
              {group.items.map((item) => {
                const itemActive = isActive(item.id);
                return (
                  <a
                    key={item.id}
                    href={item.href}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 10px",
                      background: itemActive ? "var(--bg-card)" : "transparent",
                      border: "none",
                      borderRadius: "var(--r-sm)",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: itemActive ? 500 : 400,
                      color: itemActive ? "var(--fg)" : "var(--fg-muted)",
                      textAlign: "left",
                      marginBottom: 1,
                      boxShadow: itemActive ? "var(--shadow-sm)" : "none",
                      position: "relative",
                      textDecoration: "none",
                    }}
                    onMouseEnter={(e) => {
                      if (!itemActive)
                        (e.currentTarget as HTMLElement).style.background =
                          "var(--bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (!itemActive)
                        (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                  >
                    {itemActive && (
                      <span
                        style={{
                          position: "absolute",
                          left: -8,
                          top: 8,
                          bottom: 8,
                          width: 2,
                          background: "var(--cyan-500)",
                          borderRadius: 2,
                        }}
                      />
                    )}
                    <span
                      style={{
                        color: itemActive ? "var(--cyan-600)" : "var(--fg-dim)",
                      }}
                    >
                      {item.icon}
                    </span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {item.count != null && (
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--fg-dim)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {item.count}
                      </span>
                    )}
                    {item.kbd && (
                      <span
                        className="mono"
                        style={{
                          fontSize: 10,
                          padding: "1px 4px",
                          background: "var(--bg-soft)",
                          border: "1px solid var(--border)",
                          borderRadius: 3,
                          color: "var(--fg-dim)",
                        }}
                      >
                        {item.kbd}
                      </span>
                    )}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer: user + theme toggle */}
        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              background:
                "linear-gradient(135deg, var(--cyan-600), var(--cyan-400))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            OT
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.2 }}>
              Local
            </div>
            <div style={{ fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.2 }}>
              v{version ?? "—"}
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              setTheme((current) => (current === "dark" ? "light" : "dark"))
            }
            style={{
              width: 26,
              height: 26,
              border: "1px solid var(--border)",
              background: "var(--bg-card)",
              borderRadius: "var(--r-sm)",
              cursor: "pointer",
              color: "var(--fg-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {theme === "dark" ? Icons.sun : Icons.moon}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          background: "var(--bg)",
        }}
      >
        {/* Topbar: breadcrumbs + actions */}
        <header
          style={{
            height: 48,
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "var(--fg-muted)",
            }}
          >
            <span>{project}</span>
            <span style={{ color: "var(--fg-dim)" }}>{Icons.chevRight}</span>
            <span style={{ color: "var(--fg)", fontWeight: 500 }}>
              {activeLabel}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 12,
              color: "var(--fg-muted)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                className="ot-pulse"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: "var(--ok)",
                }}
              />
              <span>Online</span>
            </div>
            <div
              style={{
                width: 1,
                height: 14,
                background: "var(--border)",
              }}
            />
            <button
              type="button"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--fg)",
                fontFamily: "inherit",
              }}
            >
              {Icons.bell}
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.hash = "#/run";
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 10px 5px 8px",
                background: "var(--cyan-500)",
                border: "none",
                borderRadius: "var(--r-sm)",
                cursor: "pointer",
                fontSize: 12,
                color: "#fff",
                fontWeight: 500,
                fontFamily: "inherit",
              }}
            >
              {Icons.play}
              <span>Run</span>
            </button>
          </div>
        </header>

        {/* View body */}
        <div style={{ flex: 1, overflowY: "auto" }}>{children}</div>
      </main>
    </div>
  );
}
