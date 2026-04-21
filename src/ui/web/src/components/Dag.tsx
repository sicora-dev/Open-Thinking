export type DagStage = {
  id: string;
  label: string;
  provider: string;
  model: string;
  status: "done" | "running" | "pending" | "failed" | "idle";
  layer: number;
  depends_on?: string[];
  duration?: string;
};

type DagProps = {
  stages: DagStage[];
  width?: number;
  height?: number;
  active?: string;
  onSelect?: (id: string) => void;
  compact?: boolean;
};

const STATUS_COLOR: Record<string, string> = {
  done: "var(--ok)",
  running: "var(--cyan-500)",
  pending: "var(--fg-dim)",
  failed: "var(--err)",
  idle: "var(--fg-dim)",
};

export function Dag({
  stages,
  width = 720,
  height = 260,
  active,
  onSelect,
  compact = false,
}: DagProps) {
  const nodeW = compact ? 120 : 170;
  const nodeH = compact ? 52 : 72;
  const gapX = compact ? 40 : 70;
  const gapY = 22;

  // Group by layer
  const byLayer: Record<number, DagStage[]> = {};
  for (const s of stages) {
    (byLayer[s.layer] ??= []).push(s);
  }
  const layers = Object.keys(byLayer)
    .map(Number)
    .sort((a, b) => a - b);

  // Assign positions
  const pos: Record<string, { x: number; y: number }> = {};
  for (let li = 0; li < layers.length; li++) {
    const arr = byLayer[layers[li]];
    const totalH = arr.length * nodeH + (arr.length - 1) * gapY;
    for (let si = 0; si < arr.length; si++) {
      pos[arr[si].id] = {
        x: 20 + li * (nodeW + gapX),
        y: (height - totalH) / 2 + si * (nodeH + gapY),
      };
    }
  }

  const stageMap = new Map(stages.map((s) => [s.id, s]));

  return (
    <svg
      width={width}
      height={height}
      style={{ display: "block", overflow: "visible" }}
    >
      {/* Edges */}
      {stages.map((s) =>
        (s.depends_on ?? []).map((dep) => {
          const from = pos[dep];
          const to = pos[s.id];
          if (!from || !to) return null;
          const fx = from.x + nodeW;
          const fy = from.y + nodeH / 2;
          const tx = to.x;
          const ty = to.y + nodeH / 2;
          const mx = (fx + tx) / 2;
          const path = `M${fx},${fy} C${mx},${fy} ${mx},${ty} ${tx},${ty}`;
          const depStage = stageMap.get(dep);
          const live =
            s.status === "running" || depStage?.status === "running";
          return (
            <path
              key={`${s.id}-${dep}`}
              d={path}
              stroke={live ? "var(--cyan-500)" : "var(--border-strong)"}
              strokeWidth={live ? 1.5 : 1}
              fill="none"
              className={live ? "ot-flow-live" : undefined}
            />
          );
        }),
      )}

      {/* Nodes */}
      {stages.map((s) => {
        const p = pos[s.id];
        if (!p) return null;
        const isActive = s.id === active;
        const sc = STATUS_COLOR[s.status] ?? "var(--fg-dim)";
        return (
          <g
            key={s.id}
            className="dag-node"
            transform={`translate(${p.x},${p.y})`}
            onClick={() => onSelect?.(s.id)}
            style={{ cursor: onSelect ? "pointer" : "default" }}
          >
            <rect
              width={nodeW}
              height={nodeH}
              rx="8"
              fill="var(--bg-card)"
              stroke={isActive ? "var(--cyan-500)" : "var(--border)"}
              strokeWidth={isActive ? 1.5 : 1}
              filter={
                isActive
                  ? "drop-shadow(0 2px 8px rgba(6,182,212,0.15))"
                  : undefined
              }
            />
            {/* Status dot */}
            <circle
              cx="12"
              cy="14"
              r="3.5"
              fill={sc}
              className={s.status === "running" ? "ot-pulse" : undefined}
            />
            <text
              x="22"
              y="18"
              fill="var(--fg)"
              fontSize="12"
              fontWeight="500"
              fontFamily="var(--font-sans)"
            >
              {s.label}
            </text>
            <text
              x="12"
              y="36"
              fill="var(--fg-muted)"
              fontSize="10.5"
              fontFamily="var(--font-mono)"
            >
              {s.provider}
            </text>
            {!compact && (
              <text
                x="12"
                y="52"
                fill="var(--fg-dim)"
                fontSize="10"
                fontFamily="var(--font-mono)"
              >
                {s.model}
              </text>
            )}
            {!compact && s.duration && (
              <text
                x={nodeW - 12}
                y="52"
                textAnchor="end"
                fill="var(--fg-dim)"
                fontSize="10"
                fontFamily="var(--font-mono)"
              >
                {s.duration}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
