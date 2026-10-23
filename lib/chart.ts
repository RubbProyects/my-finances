// Helpers for the charts: time ranges and SVG paths. Pure functions, no React.
import { addDays } from "@/lib/analysis";

export type ChartPoint = { date: string; value: number };

export const RANGES = [
  { id: "1m", text: "1M", days: 30 },
  { id: "3m", text: "3M", days: 91 },
  { id: "6m", text: "6M", days: 182 },
  { id: "1y", text: "1A", days: 365 },
  { id: "all", text: "Máx", days: 0 },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

// Points of the last `days` days (0 = all of them)
export function inRange(points: ChartPoint[], days: number): ChartPoint[] {
  if (days === 0 || points.length === 0) return points;
  const from = addDays(points[points.length - 1].date, -days);
  const cut = points.filter((p) => p.date >= from);
  return cut.length >= 2 ? cut : points.slice(-2);
}

// Keeps at most `max` points (evenly spaced, always the first and the last one)
export function thin(points: ChartPoint[], max: number): ChartPoint[] {
  if (points.length <= max) return points;
  const out: ChartPoint[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round((i / (max - 1)) * (points.length - 1))]);
  return out;
}

// Line and filled-area paths for the given size. Returns the scale functions too.
export function buildPaths(points: ChartPoint[], width: number, height: number, pad = 6) {
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (height - pad * 2);
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join("");
  const area = `${line}L${width},${height}L0,${height}Z`;
  return { line, area, x, y };
}

// Change between the first and the last point
export function change(points: ChartPoint[]): { diff: number; pct: number | null } {
  if (points.length < 2) return { diff: 0, pct: null };
  const first = points[0].value;
  const diff = points[points.length - 1].value - first;
  return { diff, pct: first > 0 ? (diff / first) * 100 : null };
}
