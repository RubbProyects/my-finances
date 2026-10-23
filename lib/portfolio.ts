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
  // Euros of this asset that were bought with a fund switch (not new money)
  switchedIn: number;
};

export type Portfolio = {
  assets: MarketAsset[];
  rows: PortfolioRow[];
  error: string;
};

// Euros bought with a fund switch, by asset (the buying half of each switch)
async function fetchSwitchedIn(): Promise<Map<string, number>> {
  const byAsset = new Map<string, number>();
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select("asset_id, amount, fee")
      .eq("type", "buy")
      .not("switch_id", "is", null)
      .order("id")
      .range(i, i + 999);
    if (error) return byAsset;
    for (const o of data ?? []) {
      byAsset.set(o.asset_id, (byAsset.get(o.asset_id) ?? 0) + Number(o.amount) + Number(o.fee));
    }
    if ((data?.length ?? 0) < 1000) return byAsset;
  }
}

export async function fetchPortfolio(): Promise<Portfolio> {
  const [assetsRes, positionsRes, pricesRes, switchedRes] = await Promise.all([
    supabase
      .from("assets")
      .select(
        "id, name, currency, type_id, platform_id, ticker, price_source, price_status, platforms(name), asset_types!inner(valuation)",
      )
      .eq("asset_types.valuation", "market")
      .order("created_at"),
    supabase.from("positions").select("*"),
    supabase.from("latest_prices").select("*"),
    fetchSwitchedIn(),
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
      return { a, pos, latest: last, value, gain, pct, switchedIn: switchedRes.get(a.id) ?? 0 };
    })
    .filter((f) => f !== null);

  return { assets, rows, error: failure ? failure.message : "" };
}

export { portfolioTotals } from "@/lib/portfolio-totals";
