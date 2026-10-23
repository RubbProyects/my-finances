"use client";

import { useEffect, useMemo, useState } from "react";
import AreaChart from "@/components/AreaChart";
import { change, inRange, RANGES, type ChartPoint, type RangeId } from "@/lib/chart";
import { gainColor, pctWithSign, prettyDate, price } from "@/lib/format";
import { language, t } from "@/lib/language";
import { supabase } from "@/lib/supabase";

// Price chart of one holding, with the same ranges as the Summary
export default function PositionChart({ assetId, version }: { assetId: string; version: number }) {
  const [points, setPoints] = useState<ChartPoint[] | null>(null);
  const [rangeId, setRangeId] = useState<RangeId>("1y");
  const [hover, setHover] = useState<ChartPoint | null>(null);

  useEffect(() => {
    // The latest 1000 prices (about four years of days), oldest first
    supabase
      .from("prices")
      .select("date, price")
      .eq("asset_id", assetId)
      .order("date", { ascending: false })
      .limit(1000)
      .then(({ data }) =>
        setPoints(
          ((data ?? []) as { date: string; price: number }[])
            .map((p) => ({ date: p.date, value: Number(p.price) }))
            .reverse(),
        ),
      );
  }, [assetId, version]);

  const days = RANGES.find((r) => r.id === rangeId)?.days ?? 0;
  const shown = useMemo(() => inRange(points ?? [], days), [points, days]);
  const range = change(shown);

  if (points === null) return <div className="h-40 animate-pulse rounded-xl bg-surface-2" />;
  if (points.length < 2) {
    return (
      <p className="text-sm text-muted">
        {t("Aún no hay suficientes precios para dibujar la gráfica.", "Not enough prices yet to draw the chart.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm">
        {hover ? (
          <>
            <span className="text-muted">{prettyDate(hover.date)} · </span>
            <span className="font-semibold">{price(hover.value)}</span>
          </>
        ) : (
          <span className={`font-semibold ${gainColor(range.diff)}`}>
            {range.pct !== null ? pctWithSign(range.pct) : ""}{" "}
            <span className="font-normal text-muted">{t("en este periodo", "in this period")}</span>
          </span>
        )}
      </p>
      <AreaChart
        points={shown}
        height={130}
        positive={range.diff >= 0}
        onHover={setHover}
        label={t("Gráfica del precio", "Price chart")}
      />
      <div className="flex justify-between gap-1" role="group">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            className="chip flex-1 px-1"
            aria-pressed={rangeId === r.id}
            onClick={() => {
              setRangeId(r.id);
              setHover(null);
            }}
          >
            {r.id === "all" ? t("Máx", "Max") : r.text.replace("A", language() === "en" ? "Y" : "A")}
          </button>
        ))}
      </div>
    </div>
  );
}
