// Investment portfolio data and calculations (used by Summary and Investments)
import { supabase } from "@/lib/supabase";

export type MarketAsset = {
  id: string;
  name: string;
  currency: string;
  type_id: string;
  platform_id: string | null;
  ticker: string | null;
  price_source: string;
  price_status: string | null;
  platforms: { name: string } | null;
};

export type Position = {
  asset_id: string;
  units: number;
  bought: number;
  sold: number;
  dividends: number;
  fees: number;
};

export type LatestPrice = { asset_id: string; date: string; price: number };

export type PortfolioRow = {
  a: MarketAsset;
  pos: Position;
  latest: LatestPrice | null;
  value: number | null;
  gain: number | null;
  pct: number | null;
};

export type Portfolio = {
  assets: MarketAsset[];
  rows: PortfolioRow[];
  error: string;
};

export async function fetchPortfolio(): Promise<Portfolio> {
  const [assetsRes, positionsRes, pricesRes] = await Promise.all([
    supabase
      .from("assets")
      .select(
        "id, name, currency, type_id, platform_id, ticker, price_source, price_status, platforms(name), asset_types!inner(valuation)",
      )
      .eq("asset_types.valuation", "market")
      .order("created_at"),
    supabase.from("positions").select("*"),
    supabase.from("latest_prices").select("*"),
  ]);
  const failure = [assetsRes, positionsRes, pricesRes].map((r) => r.error).find(Boolean);

  // Database numbers may arrive as text: we convert them
  const positions: Position[] = ((positionsRes.data ?? []) as Position[]).map((p) => ({
    asset_id: p.asset_id,
    units: Number(p.units),
    bought: Number(p.bought),
    sold: Number(p.sold),
    dividends: Number(p.dividends),
    fees: Number(p.fees),
  }));
  const prices: LatestPrice[] = ((pricesRes.data ?? []) as LatestPrice[]).map((p) => ({
    ...p,
    price: Number(p.price),
  }));
  const assets = (assetsRes.data ?? []) as unknown as MarketAsset[];

  // Value and gain of each asset with activity
  const rows = assets
    .map((a) => {
      const pos = positions.find((p) => p.asset_id === a.id);
      if (!pos) return null;
      const last = prices.find((p) => p.asset_id === a.id) ?? null;
      const value = last ? pos.units * last.price : null;
      const gain = value !== null ? value + pos.sold + pos.dividends - pos.bought : null;
      const pct = gain !== null && pos.bought > 0 ? (gain / pos.bought) * 100 : null;
      return { a, pos, latest: last, value, gain, pct };
    })
    .filter((f) => f !== null);

  return { assets, rows, error: failure ? failure.message : "" };
}

// Portfolio totals (only counts assets that already have a price)
export function portfolioTotals(rows: PortfolioRow[]) {
  const withPrice = rows.filter((f) => f.value !== null);
  const value = withPrice.reduce((s, f) => s + (f.value ?? 0), 0);
  const bought = withPrice.reduce((s, f) => s + f.pos.bought, 0);
  const gain = withPrice.reduce((s, f) => s + (f.gain ?? 0), 0);
  return {
    value,
    gain,
    pct: bought > 0 ? (gain / bought) * 100 : null,
    noPrice: rows.length - withPrice.length,
  };
}
