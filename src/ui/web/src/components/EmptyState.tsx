import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="p-10 text-center">
      <div className="inline-flex min-w-[280px] max-w-[520px] flex-col items-center gap-3 border border-dashed border-ink-600 bg-ink-900/60 px-6 py-8">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-sm text-ink-400">{description}</div>
        {action && <div className="pt-1">{action}</div>}
      </div>
    </div>
  );
}
