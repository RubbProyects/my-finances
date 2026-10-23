"use client";

import { useState } from "react";
import type { SeriesPoint } from "@/lib/analysis";
import { euros, prettyDate } from "@/lib/format";
import { language, locale, t } from "@/lib/language";

const WIDTH = 340;
const HEIGHT = 190;
const M = { left: 46, right: 8, top: 8, bottom: 22 };

// "8,2 mil €" (in English, "€8.2K")
function compact(n: number): string {
  const text = new Intl.NumberFormat(locale(), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
  return language() === "en" ? `€${text}` : `${text} €`;
}

// Line chart: portfolio value (blue, solid) and money contributed (orange, dashed).
// Tapping or hovering marks the day and its values are shown above.
export default function EvolutionChart({ series }: { series: SeriesPoint[] }) {
  const [index, setIndex] = useState<number | null>(null);
  if (series.length < 2)
    return (
      <p className="text-sm opacity-70">
        {t("Aún no hay datos suficientes.", "Not enough data yet.")}
      </p>
    );

  const values = series.flatMap((p) => [p.value, p.contributed]);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.08;
  min = Math.max(0, min - pad);
  max += pad;

  const x = (i: number) => M.left + (i / (series.length - 1)) * (WIDTH - M.left - M.right);
  const y = (v: number) => M.top + (1 - (v - min) / (max - min)) * (HEIGHT - M.top - M.bottom);
  const line = (field: "value" | "contributed") =>
    series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[field]).toFixed(1)}`).join("");
  const gridLines = [0, 0.5, 1].map((t) => min + t * (max - min));

  const current = series[index ?? series.length - 1];
  const iCurrent = index ?? series.length - 1;

  function move(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * WIDTH;
    const i = Math.round(((px - M.left) / (WIDTH - M.left - M.right)) * (series.length - 1));
    setIndex(Math.min(series.length - 1, Math.max(0, i)));
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Legend and reading for the marked day */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-[#2a78d6] dark:bg-[#3987e5]" />{" "}
          {t("Valor", "Value")}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 border-t-2 border-dashed border-[#eb6834] dark:border-[#d95926]" />{" "}
          {t("Aportado", "Contributed")}
        </span>
      </div>
      <p className="text-sm">
        <span className="opacity-70">{prettyDate(current.date)} · </span>
        <span className="font-semibold">{euros(current.value)}</span>
        <span className="opacity-70">
          {" "}
          · {t("aportado", "contributed")} {euros(current.contributed)}
        </span>
      </p>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-pan-y select-none"
        role="img"
        aria-label={t(
          "Evolución del valor de la cartera frente al dinero aportado",
          "Portfolio value over time compared with money contributed",
        )}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setIndex(null)}
      >
        {gridLines.map((v) => (
          <g key={v}>
            <line
              x1={M.left}
              x2={WIDTH - M.right}
              y1={y(v)}
              y2={y(v)}
              className="stroke-line"
              strokeWidth={1}
            />
            <text
              x={M.left - 4}
              y={y(v) + 3}
              textAnchor="end"
              className="fill-current text-[10px] opacity-60"
            >
              {compact(v)}
            </text>
          </g>
        ))}
        <text x={M.left} y={HEIGHT - 6} className="fill-current text-[10px] opacity-60">
          {prettyDate(series[0].date)}
        </text>
        <text
          x={WIDTH - M.right}
          y={HEIGHT - 6}
          textAnchor="end"
          className="fill-current text-[10px] opacity-60"
        >
          {prettyDate(series[series.length - 1].date)}
        </text>

        <path
          d={line("contributed")}
          fill="none"
          strokeWidth={2}
          strokeDasharray="5 4"
          className="stroke-[#eb6834] dark:stroke-[#d95926]"
        />
        <path
          d={line("value")}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          className="stroke-[#2a78d6] dark:stroke-[#3987e5]"
        />

        {/* Mark for the selected day */}
        <line
          x1={x(iCurrent)}
          x2={x(iCurrent)}
          y1={M.top}
          y2={HEIGHT - M.bottom}
          className="stroke-muted/60"
          strokeWidth={1}
        />
        <circle
          cx={x(iCurrent)}
          cy={y(current.contributed)}
          r={4}
          strokeWidth={2}
          className="fill-[#eb6834] stroke-[var(--background)] dark:fill-[#d95926]"
        />
        <circle
          cx={x(iCurrent)}
          cy={y(current.value)}
          r={4}
          strokeWidth={2}
          className="fill-[#2a78d6] stroke-[var(--background)] dark:fill-[#3987e5]"
        />
      </svg>
    </div>
  );
}
