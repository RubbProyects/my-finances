"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AreaChart from "@/components/AreaChart";
import RecordActivity from "@/components/RecordActivity";
import { callApi } from "@/lib/api";
import type { ChartPoint } from "@/lib/chart";
import { gainColor, marketPrice, pctWithSign } from "@/lib/format";
import { language, locale, t } from "@/lib/language";
import type { MarketChart } from "@/lib/yahoo";

export type Instrument = { symbol: string; name: string; source: "yahoo" | "ft" };

const RANGES = [
  { id: "1d", text: "1D" },
  { id: "5d", text: "5D" },
  { id: "1m", text: "1M" },
  { id: "6m", text: "6M" },
  { id: "1y", text: "1Y" },
  { id: "5y", text: "5Y" },
  { id: "max", text: "Max" },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

// The price refreshes by itself while the screen is open (Yahoo has a few minutes of delay)
const REFRESH_MS = 30_000;

function when(iso: string, intraday: boolean): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale(), {
    day: "numeric",
    month: "short",
    year: intraday ? undefined : "numeric",
    ...(intraday ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(d);
}

export default function MarketDetail({
  item,
  starred,
  onStar,
  onBack,
}: {
  item: Instrument;
  starred: boolean;
  onStar: () => void;
  onBack: () => void;
}) {
  const [range, setRange] = useState<RangeId>("6m");
  const [data, setData] = useState<MarketChart | null>(null);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<ChartPoint | null>(null);

  const load = useCallback(() => {
    callApi<MarketChart>(
      `/api/market/chart?symbol=${encodeURIComponent(item.symbol)}&source=${item.source}&range=${range}`,
    )
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [item.symbol, item.source, range]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const intraday = range === "1d" || range === "5d";
  const points: ChartPoint[] = useMemo(
    () =>
      (data?.points ?? []).map((p) => ({
        date: new Date(p.t).toISOString(),
        value: p.value,
      })),
    [data],
  );

  const first = points[0]?.value ?? null;
  const last = data?.price ?? points[points.length - 1]?.value ?? null;
  // In 1D the change is against yesterday's close; in the other ranges, against the start of the range
  const base = range === "1d" ? (data?.previousClose ?? first) : first;
  const diff = last !== null && base !== null ? last - base : null;
  const pct = diff !== null && base ? (diff / base) * 100 : null;
  const currency = data?.currency ?? null;
  const shown = hover?.value ?? last;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between px-1">
        <button type="button" onClick={onBack} className="chip card px-3 py-1.5">
          ← {t("Volver", "Back")}
        </button>
        <button
          type="button"
          onClick={onStar}
          aria-pressed={starred}
          aria-label={starred ? t("Quitar de favoritos", "Remove from favorites") : t("Añadir a favoritos", "Add to favorites")}
          className="card rounded-full px-3 py-1 text-xl"
        >
          <span className={starred ? "text-yellow-500" : "text-muted"}>{starred ? "★" : "☆"}</span>
        </button>
      </div>

      <section className="card rise overflow-hidden pt-5">
        <div className="px-5">
          <p className="text-xs font-semibold text-muted">
            {item.symbol}
            {data?.exchange ? ` · ${data.exchange}` : ""}
          </p>
          <h2 className="text-lg font-semibold leading-tight">{data?.name ?? item.name}</h2>
          <p className="mt-2 text-4xl font-bold tracking-tight">
            {shown !== null ? marketPrice(shown, currency) : "—"}
          </p>
          <p className="mt-1 h-5 text-sm">
            {hover ? (
              <span className="text-muted">{when(hover.date, intraday)}</span>
            ) : diff !== null ? (
              <span className={`font-semibold ${gainColor(diff)}`}>
                {diff >= 0 ? "+" : "−"}
                {marketPrice(Math.abs(diff), currency)}
                {pct !== null ? ` · ${pctWithSign(pct)}` : ""}
              </span>
            ) : null}
          </p>
        </div>

        <div className="mt-2">
          {error ? (
            <p className="p-5 text-sm text-down">{error}</p>
          ) : data ? (
            <AreaChart
              points={points}
              height={190}
              positive={(diff ?? 0) >= 0}
              onHover={setHover}
              label={t("Gráfica del precio", "Price chart")}
            />
          ) : (
            <div className="h-[190px] animate-pulse bg-surface-2" />
          )}
        </div>

        <div className="flex justify-between gap-1 px-3 py-3" role="group">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className="chip flex-1 px-1"
              aria-pressed={range === r.id}
              onClick={() => {
                setRange(r.id);
                setHover(null);
              }}
            >
              {language() === "es" && r.id === "1y" ? "1A" : language() === "es" && r.id === "5y" ? "5A" : r.id === "max" ? t("Máx", "Max") : r.text}
            </button>
          ))}
        </div>
      </section>

      {data && (
        <RecordActivity
          key={item.symbol}
          listing={{
            symbol: item.symbol,
            name: data.name,
            source: item.source,
            currency: data.currency,
            type: data.type,
          }}
        />
      )}

      <p className="px-1 text-xs text-muted">
        {item.source === "ft"
          ? t(
              "Fondo: el valor liquidativo se publica una vez al día.",
              "Fund: the net asset value is published once a day.",
            )
          : t(
              "Precios de Yahoo Finance, con unos minutos de retraso. Se actualiza solo cada 30 segundos.",
              "Prices from Yahoo Finance, a few minutes delayed. Refreshes by itself every 30 seconds.",
            )}
      </p>
    </div>
  );
}
