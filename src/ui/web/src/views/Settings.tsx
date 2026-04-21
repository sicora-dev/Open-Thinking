import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useToast } from "../components/ToastProvider";
import { api, type UiSettings } from "../lib/api";
import { formatRelative } from "../lib/run-events";

function Section({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div style={{ padding: "24px 0", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "260px 1fr", gap: 40 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 3 }}>{desc}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function ReadonlyField({ label, value, mono, hint }: { label: string; value: string; mono?: boolean; hint?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 5, fontWeight: 500 }}>{label}</div>
      <div
        className={mono ? "mono" : undefined}
        style={{
          width: "100%", padding: "7px 10px", background: "var(--bg-card)",
          border: "1px solid var(--border)", borderRadius: "var(--r-md)",
          fontSize: 13, color: "var(--fg)", overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
      {hint && <div style={{ fontSize: 11.5, color: "var(--fg-dim)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

type SettingsState = {
  health: { version: string; port: number; startedAt: string } | null;
  settings: UiSettings | null;
  configDir: string | null;
  providers: { total: number; configured: number };
  projects: number;
  pipelines: number;
  skills: number;
};

const EMPTY: SettingsState = {
  health: null,
  settings: null,
  configDir: null,
  providers: { total: 0, configured: 0 },
  projects: 0,
  pipelines: 0,
  skills: 0,
};

export function Settings() {
  const { pushToast } = useToast();
  const [state, setState] = useState<SettingsState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [health, settings, providers, projects, pipelines, skills] = await Promise.all([
        api.health(),
        api.getSettings(),
        api.listProviders(),
        api.listProjects(),
        api.listPipelines(),
        api.listSkills({ includeGlobal: true }),
      ]);
      setState({
        health,
        settings: settings.config,
        configDir: settings.configDir,
        providers: {
          total: providers.length,
          configured: providers.filter((provider) => provider.configured).length,
        },
        projects: projects.length,
        pipelines: pipelines.length,
        skills: skills.length,
      });
      setError(null);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      pushToast({ kind: "error", title: "Could not load settings", description: message });
    }
  }, [pushToast]);

  useEffect(() => {
    load();
  }, [load]);

  const autostart =
    state.settings?.ui?.autostart === true
      ? "true"
      : state.settings?.ui?.autostart === false
        ? "false"
        : "ask";

  const saveAutostart = async (value: string) => {
    setSaving(true);
    try {
      const autostartValue = value === "ask" ? null : value === "true";
      const result = await api.saveSettings({ ui: { autostart: autostartValue } });
      setState((current) => ({
        ...current,
        settings: result.config,
        configDir: result.configDir,
      }));
      pushToast({ kind: "success", title: "Settings saved" });
    } catch (e) {
      pushToast({ kind: "error", title: "Could not save settings", description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: "24px 28px 60px", maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, margin: "0 0 4px" }}>Settings</h1>
      <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: 0 }}>Configuration exposed by the UI API</p>

      {error && (
        <div style={{ marginTop: 16, background: "var(--bg-card)", border: "1px solid var(--err)", borderRadius: "var(--r-md)", padding: 12, color: "var(--err)", fontSize: 13 }}>
          {error}
        </div>
      )}

      <Section title="Runtime" desc="Current UI server process.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <ReadonlyField label="Version" value={state.health?.version ?? "Unavailable"} mono />
          <ReadonlyField label="Port" value={state.health ? String(state.health.port) : "Unavailable"} mono />
          <ReadonlyField label="Started" value={state.health ? formatRelative(state.health.startedAt) : "Unavailable"} />
          <ReadonlyField label="Config directory" value={state.configDir ?? "Unavailable"} mono />
        </div>
      </Section>

      <Section title="Workspace index" desc="Counts returned by projects, pipelines, skills, and providers endpoints.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <ReadonlyField label="Projects" value={String(state.projects)} mono />
          <ReadonlyField label="Pipelines" value={String(state.pipelines)} mono />
          <ReadonlyField label="Skills" value={String(state.skills)} mono />
          <ReadonlyField label="Providers configured" value={`${state.providers.configured} / ${state.providers.total}`} mono />
        </div>
      </Section>

      <Section title="UI config" desc="Stored in the OpenThinking config file.">
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 5, fontWeight: 500 }}>Autostart UI</div>
          <select
            value={autostart}
            disabled={saving}
            onChange={(event) => saveAutostart(event.target.value)}
            style={{
              width: "100%", padding: "7px 10px", background: "var(--bg-card)",
              border: "1px solid var(--border)", borderRadius: "var(--r-md)",
              fontSize: 13, color: "var(--fg)", fontFamily: "inherit", outline: "none",
            }}
          >
            <option value="ask">Ask on next run</option>
            <option value="true">Start automatically</option>
            <option value="false">Do not start automatically</option>
          </select>
          <div style={{ fontSize: 11.5, color: "var(--fg-dim)", marginTop: 4 }}>
            This is the existing <span className="mono">ui.autostart</span> setting.
          </div>
        </div>
      </Section>
    </div>
  );
}
