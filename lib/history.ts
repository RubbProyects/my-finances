// Price and activity history used to draw charts (portfolio curve and per-asset trends)
import {
  addDays,
  portfolioSeries,
  type AssetInfo,
  type DayPrice,
  type Op,
} from "@/lib/analysis";
import type { ChartPoint } from "@/lib/chart";
import { today } from "@/lib/format";
import { supabase } from "@/lib/supabase";

export type History = {
  portfolio: ChartPoint[];
  contributed: number;
  byAsset: Map<string, ChartPoint[]>;
};

export const EMPTY_HISTORY: History = { portfolio: [], contributed: 0, byAsset: new Map() };

// Supabase returns at most 1000 rows per request: we fetch page by page
async function allPages<T>(
  page: (
    from: number,
    until: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await page(i, i + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}

export async function fetchHistory(assets: AssetInfo[]): Promise<History> {
  try {
    if (assets.length === 0) return EMPTY_HISTORY;
    const [ops, prices] = await Promise.all([
      allPages<Op>((d, h) =>
        supabase
          .from("transactions")
          .select("asset_id, date, type, amount, fee, withholding, units, factor")
          .order("date")
          .order("id")
          .range(d, h),
      ),
      allPages<DayPrice & { asset_id: string }>((d, h) =>
        supabase
          .from("prices")
          .select("asset_id, date, price")
          .order("asset_id")
          .order("date")
          .range(d, h),
      ),
    ]);
    const byAsset = new Map<string, DayPrice[]>();
    for (const p of prices) {
      const list = byAsset.get(p.asset_id) ?? [];
      list.push({ date: p.date, price: Number(p.price) });
      byAsset.set(p.asset_id, list);
    }
    const clean = ops.map((o) => ({ ...o, amount: Number(o.amount), fee: Number(o.fee) }));
    if (clean.length === 0) return EMPTY_HISTORY;

    const end = today();
    const start = clean[0].date;
    const series = portfolioSeries(assets, clean, byAsset, start, end);
    const trends = new Map<string, ChartPoint[]>();
    const from = addDays(end, -365);
    for (const [id, list] of byAsset) {
      trends.set(
        id,
        list.filter((p) => p.date >= from).map((p) => ({ date: p.date, value: p.price })),
      );
    }
    return {
      portfolio: series.map((p) => ({ date: p.date, value: p.value })),
      contributed: series.length ? series[series.length - 1].contributed : 0,
      byAsset: trends,
    };
  } catch {
    return EMPTY_HISTORY;
  }
}
