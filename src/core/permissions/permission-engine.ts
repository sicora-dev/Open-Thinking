/**
 * Permission engine: evaluates whether a tool action should be
 * allowed, denied, or requires human confirmation.
 *
 * Decision flow:
 * 1. Check mode — "auto" allows everything immediately
 * 2. Check persistent rules — "allow always" / "deny always"
 * 3. Classify risk — safe actions auto-pass in "confirm" mode
 * 4. If still undecided, create a ConfirmationGate and block
 *
 * The engine does NOT resolve confirmations — that's the job of
 * the CLI readline or UI endpoint via the ConfirmationManager.
 */
import type { EventBus } from "../events/event-bus";
import { type ConfirmationManager, createConfirmationManager } from "./confirmation-gate";
import type {
  PermissionAction,
  PermissionMode,
  PermissionRequest,
  PermissionResponse,
} from "./permission-types";
import { type PermissionStore, createPermissionStore } from "./permission-store";
import { classifyToolRisk } from "./risk-classifier";

export type PermissionEngineConfig = {
  mode: PermissionMode;
  workingDir: string;
  eventBus?: EventBus;
  /** Optional pre-built store (for testing). */
  store?: PermissionStore;
};

export type PermissionEngine = {
  /** Check if a tool action is allowed. May block waiting for human input. */
  check(
    tool: string,
    args: Record<string, unknown>,
    stageName: string,
  ): Promise<PermissionAction>;
  /** Get the confirmation manager for CLI/UI to resolve pending requests. */
  confirmations(): ConfirmationManager;
  /** Get the permission store for managing persistent rules. */
  store(): PermissionStore;
  /** Current permission mode. */
  mode(): PermissionMode;
};

export function createPermissionEngine(config: PermissionEngineConfig): PermissionEngine {
  const { mode, workingDir, eventBus } = config;
  const store = config.store ?? createPermissionStore();
  const confirmationMgr = createConfirmationManager();

  async function check(
    tool: string,
    args: Record<string, unknown>,
    stageName: string,
  ): Promise<PermissionAction> {
    // Mode: auto — everything allowed
    if (mode === "auto" || mode === "sandbox") {
      emitAutoAllowed(tool, args, stageName);
      return "allow";
    }

    const { risk, subject, description } = classifyToolRisk(tool, args, workingDir);

    // Check persistent rules first
    const rule = store.findRule(tool, subject);
    if (rule) {
      if (rule.action === "allow") {
        emitAutoAllowed(tool, args, stageName);
      }
      return rule.action;
    }

    // Mode: confirm — safe actions auto-pass
    if (mode === "confirm" && risk === "safe") {
      emitAutoAllowed(tool, args, stageName);
      return "allow";
    }

    // Mode: strict — everything except reads needs confirmation
    // Mode: confirm — moderate/dangerous need confirmation
    // Either way, we need to ask the human
    const request: PermissionRequest = {
      id: crypto.randomUUID(),
      tool,
      args,
      risk,
      description,
      subject,
    };

    eventBus?.emit({
      type: "permission:request",
      request,
      stageName,
    } as import("../../shared/types").PipelineEvent);

    const response = await confirmationMgr.add(request);

    // Persist the rule if "remember" was chosen
    if (response.remember) {
      store.addRule(tool, subject, response.action);
    }

    // Emit resolution event
    eventBus?.emit({
      type: response.action === "allow" ? "permission:granted" : "permission:denied",
      requestId: request.id,
      stageName,
      remembered: response.remember,
    } as import("../../shared/types").PipelineEvent);

    return response.action;
  }

  function emitAutoAllowed(tool: string, args: Record<string, unknown>, stageName: string): void {
    const { subject } = classifyToolRisk(tool, args, workingDir);
    eventBus?.emit({
      type: "permission:auto-allowed",
      tool,
      subject,
      stageName,
    } as import("../../shared/types").PipelineEvent);
  }

  return {
    check,
    confirmations: () => confirmationMgr,
    store: () => store,
    mode: () => mode,
  };
}
