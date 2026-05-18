import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  api,
  type PendingPermission,
  type RunRow,
} from "../lib/api";
import { Icons } from "./Icons";
import { useToast } from "./ToastProvider";

type PendingItem = {
  run: RunRow;
  request: PendingPermission;
};

const riskColor: Record<PendingPermission["risk"], string> = {
  safe: "var(--ok)",
  moderate: "var(--warn)",
  dangerous: "var(--err)",
};

const panelStyle: CSSProperties = {
  position: "fixed",
  right: 18,
  bottom: 18,
  width: 420,
  maxWidth: "calc(100vw - 36px)",
  zIndex: 80,
  background: "var(--bg-card)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--r-lg)",
  boxShadow: "0 18px 48px rgba(0,0,0,0.35)",
  overflow: "hidden",
};

const buttonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: "var(--r-sm)",
  border: "1px solid var(--border)",
  background: "var(--bg-soft)",
  color: "var(--fg)",
  cursor: "pointer",
  fontSize: 12,
  fontFamily: "inherit",
};

export function PermissionCenter() {
  const { pushToast } = useToast();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    try {
      const runs = await api.listRuns();
      const activeRuns = runs.filter((run) => run.status === "running");
      const pendingGroups = await Promise.all(
        activeRuns.map(async (run) => ({
          run,
          pending: await api.listRunPermissions(run.id),
        })),
      );
      setItems(
        pendingGroups.flatMap(({ run, pending }) =>
          pending.map((request) => ({ run, request })),
        ),
      );
    } catch {
      // Keep this quiet; the rest of the UI already reports API availability.
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 1500);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const pendingCount = items.length;
  const current = items[0] ?? null;
  const title = useMemo(() => {
    if (pendingCount === 1) return "Permission required";
    return `${pendingCount} permissions required`;
  }, [pendingCount]);

  const resolve = async (item: PendingItem, action: "allow" | "deny", remember: boolean) => {
    const key = `${item.run.id}:${item.request.id}:${action}:${remember}`;
    setBusyKey(key);
    try {
      const result = await api.resolveRunPermission(
        item.run.id,
        item.request.id,
        action,
        remember,
      );
      if (!result.ok) throw new Error("Request is no longer pending.");
      pushToast({
        kind: action === "allow" ? "success" : "info",
        title: action === "allow" ? "Permission allowed" : "Permission denied",
        description: remember ? "Saved as a persistent rule." : item.request.tool,
      });
      await load();
    } catch (e) {
      pushToast({
        kind: "error",
        title: "Could not resolve permission",
        description: (e as Error).message,
      });
    } finally {
      setBusyKey(null);
    }
  };

  if (!current) return null;

  return (
    <div style={panelStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          borderBottom: collapsed ? "none" : "1px solid var(--border)",
          background: "var(--bg-soft)",
        }}
      >
        <span style={{ color: riskColor[current.request.risk] }}>{Icons.shield}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>
            {current.run.pipelineName} · {current.run.id.slice(0, 8)}
          </div>
        </div>
        <button
          type="button"
          style={{ ...buttonStyle, padding: "4px 7px" }}
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? "Show permission request" : "Collapse"}
        >
          {collapsed ? Icons.chevDown : Icons.x}
        </button>
      </div>

      {!collapsed && (
        <div style={{ padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span
              style={{
                color: riskColor[current.request.risk],
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              {current.request.risk}
            </span>
            <span className="mono" style={{ fontSize: 12, color: "var(--fg)" }}>
              {current.request.tool}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--fg)", lineHeight: 1.45 }}>
            {current.request.description}
          </div>
          <div
            className="mono"
            style={{
              marginTop: 10,
              padding: 8,
              background: "var(--bg-soft)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)",
              color: "var(--fg-muted)",
              fontSize: 11.5,
              overflowWrap: "anywhere",
            }}
          >
            {current.request.subject}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
            <ActionButton
              label="Allow once"
              disabled={busyKey != null}
              busy={busyKey === `${current.run.id}:${current.request.id}:allow:false`}
              onClick={() => resolve(current, "allow", false)}
              tone="allow"
            />
            <ActionButton
              label="Allow always"
              disabled={busyKey != null}
              busy={busyKey === `${current.run.id}:${current.request.id}:allow:true`}
              onClick={() => resolve(current, "allow", true)}
              tone="allow"
            />
            <ActionButton
              label="Deny once"
              disabled={busyKey != null}
              busy={busyKey === `${current.run.id}:${current.request.id}:deny:false`}
              onClick={() => resolve(current, "deny", false)}
              tone="deny"
            />
            <ActionButton
              label="Deny always"
              disabled={busyKey != null}
              busy={busyKey === `${current.run.id}:${current.request.id}:deny:true`}
              onClick={() => resolve(current, "deny", true)}
              tone="deny"
            />
          </div>

          {pendingCount > 1 && (
            <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--fg-muted)" }}>
              Resolve this request to continue with the next one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  label,
  disabled,
  busy,
  onClick,
  tone,
}: {
  label: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
  tone: "allow" | "deny";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        ...buttonStyle,
        opacity: disabled && !busy ? 0.55 : 1,
        cursor: disabled ? "wait" : "pointer",
        color: tone === "allow" ? "var(--ok)" : "var(--err)",
      }}
    >
      {busy ? "Working..." : label}
    </button>
  );
}
