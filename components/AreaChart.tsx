"use client";

import { useId, useState } from "react";
import { buildPaths, type ChartPoint } from "@/lib/chart";

const WIDTH = 340;

// Smooth filled line chart. Touch or hover to read a day: `onHover` receives the point
// (or null when the finger leaves) so the parent can show it in its big number.
export default function AreaChart({
  points,
  height = 150,
  positive = true,
  onHover,
  label,
}: {
  points: ChartPoint[];
  height?: number;
  positive?: boolean;
  onHover?: (p: ChartPoint | null) => void;
  label: string;
}) {
  const id = useId();
  const [index, setIndex] = useState<number | null>(null);
  if (points.length < 2) return <div style={{ height }} />;

  const { line, area, x, y } = buildPaths(points, WIDTH, height);
  const color = positive ? "var(--up)" : "var(--down)";

  function move(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1));
    const clamped = Math.min(points.length - 1, Math.max(0, i));
    setIndex(clamped);
    onHover?.(points[clamped]);
  }
  function leave() {
    setIndex(null);
    onHover?.(null);
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="w-full touch-pan-y select-none"
      style={{ height }}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      onPointerMove={move}
      onPointerDown={move}
      onPointerLeave={leave}
      onPointerCancel={leave}
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2.25}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {index !== null && (
        <>
          <line
            x1={x(index)}
            x2={x(index)}
            y1={0}
            y2={height}
            stroke="var(--muted)"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={x(index)} cy={y(points[index].value)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
        </>
      )}
    </svg>
  );
}
