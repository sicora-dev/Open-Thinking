/**
 * Confirmation gate: a resolvable promise that blocks tool execution
 * until a human approves or denies the action.
 *
 * This is the bridge between the permission engine and the CLI/UI.
 * The engine creates a gate, the CLI readline or UI endpoint resolves it.
 */
import type { PermissionRequest, PermissionResponse } from "./permission-types";

export type ConfirmationResolver = (response: PermissionResponse) => void;

export type PendingConfirmation = {
  request: PermissionRequest;
  resolve: ConfirmationResolver;
  promise: Promise<PermissionResponse>;
};

/**
 * Create a confirmation gate for a permission request.
 * Returns a pending confirmation whose promise resolves when
 * `resolve()` is called (from CLI readline or UI endpoint).
 */
export function createConfirmation(request: PermissionRequest): PendingConfirmation {
  let resolveRef: ConfirmationResolver | null = null;
  const promise = new Promise<PermissionResponse>((res) => {
    resolveRef = res;
  });
  return {
    request,
    resolve: resolveRef as unknown as ConfirmationResolver,
    promise,
  };
}

/**
 * Manages pending confirmations for a pipeline run.
 * Used by the CLI and UI to find and resolve pending requests.
 */
export type ConfirmationManager = {
  /** Add a pending confirmation. Returns the promise that resolves when answered. */
  add(request: PermissionRequest): Promise<PermissionResponse>;
  /** Resolve a pending confirmation by request ID. Returns false if not found. */
  resolve(requestId: string, response: PermissionResponse): boolean;
  /** Get a pending confirmation by request ID. */
  get(requestId: string): PendingConfirmation | undefined;
  /** List all pending confirmations. */
  pending(): PendingConfirmation[];
  /** Clear all pending confirmations (deny all). */
  clear(): void;
};

export function createConfirmationManager(): ConfirmationManager {
  const pending = new Map<string, PendingConfirmation>();

  return {
    add(request) {
      const confirmation = createConfirmation(request);
      pending.set(request.id, confirmation);
      // Auto-cleanup when resolved
      confirmation.promise.then(() => pending.delete(request.id));
      return confirmation.promise;
    },

    resolve(requestId, response) {
      const entry = pending.get(requestId);
      if (!entry) return false;
      entry.resolve(response);
      return true;
    },

    get(requestId) {
      return pending.get(requestId);
    },

    pending() {
      return [...pending.values()];
    },

    clear() {
      for (const entry of pending.values()) {
        entry.resolve({ action: "deny", remember: false });
      }
      pending.clear();
    },
  };
}
