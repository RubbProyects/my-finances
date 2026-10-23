"use client";

import { useEffect, useState } from "react";
import { summarizeUpdates, type PricesInfo } from "@/lib/prices-info";
import { locale, t } from "@/lib/language";
import { supabase } from "@/lib/supabase";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function fetchPricesInfo(): Promise<PricesInfo> {
  const { data } = await supabase
    .from("assets")
    .select("price_updated_at, asset_types!inner(valuation)")
    .eq("asset_types.valuation", "market")
    .neq("price_source", "manual");
  return summarizeUpdates((data ?? []) as { price_updated_at: string | null }[]);
}

// "today, 14:05" / "23 Oct, 14:05"
function stamp(iso: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit" }).format(d);
  if (d.toDateString() === new Date().toDateString()) return `${t("hoy", "today")}, ${time}`;
  const day = new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short" }).format(d);
  return `${day}, ${time}`;
}

// Small line: when the prices were last updated (the oldest of your assets, to be honest)
export default function PricesStamp({ className = "" }: { className?: string }) {
  const [info, setInfo] = useState<(PricesInfo & { old: boolean }) | null>(null);

  useEffect(() => {
    fetchPricesInfo().then((i) =>
      // More than a day old: it is orange (a weekend is normal, but it is worth seeing)
      setInfo({
        ...i,
        old: i.oldest === null || Date.now() - new Date(i.oldest).getTime() > DAY_MS + 2 * 60 * 60 * 1000,
      }),
    );
  }, []);

  if (!info || info.assets === 0) return null;
  return (
    <p className={`${className} ${info.old ? "text-orange-500" : "text-muted"}`}>
      🕒{" "}
      {info.oldest
        ? `${t("Precios actualizados", "Prices updated")} ${stamp(info.oldest)}`
        : t("Los precios aún no se han actualizado", "Prices haven't been updated yet")}
    </p>
  );
}
