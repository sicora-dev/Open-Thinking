import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "info" | "success" | "error";

type ToastInput = {
  title: string;
  description?: string;
  kind?: ToastKind;
  ttlMs?: number;
};

type Toast = ToastInput & {
  id: string;
  kind: ToastKind;
};

type ToastContextValue = {
  pushToast: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    ({ ttlMs = 4000, kind = "info", ...toast }: ToastInput) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current, { id, kind, ...toast }]);
      window.setTimeout(() => removeToast(id), ttlMs);
    },
    [removeToast],
  );

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-3">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const borderTone =
    toast.kind === "success"
      ? "border-green-500"
      : toast.kind === "error"
        ? "border-red-500"
        : "border-accent";

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onDismiss]);

  return (
    <div className={`panel ${borderTone} border-l-4 shadow-lg`}>
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{toast.title}</div>
          {toast.description && (
            <div className="mt-1 text-xs text-ink-400 whitespace-pre-wrap break-words">
              {toast.description}
            </div>
          )}
        </div>
        <button className="text-ink-400 hover:text-ink-100 text-sm" onClick={onDismiss}>
          ×
        </button>
      </div>
    </div>
  );
}
