import { buildPaths, change, thin, type ChartPoint } from "@/lib/chart";

// Tiny trend line for lists. Green if it ended above where it started, red if below.
export default function Sparkline({
  points,
  width = 72,
  height = 28,
}: {
  points: ChartPoint[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return <div style={{ width, height }} />;
  const p = thin(points, 40);
  const { line } = buildPaths(p, width, height, 3);
  const up = change(p).diff >= 0;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path
        d={line}
        fill="none"
        stroke={up ? "var(--up)" : "var(--down)"}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
