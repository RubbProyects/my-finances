// Downloads and saves the prices of assets with an automatic source
// (Yahoo for ETFs, stocks and crypto; Financial Times for funds, by ISIN).
// Used by the daily cron (every user) and the "Update prices" button (only yours).
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFtHistory } from "@/lib/ft";
import { fetchHistory, type History } from "@/lib/yahoo";

export type Result = { name: string; added: number; error: string | null };

const DAY_MS = 24 * 60 * 60 * 1000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Asks the asset's configured source for its prices
function download(
  a: { price_source: string; ticker: string | null; isin: string | null; currency: string },
  from: Date,
): Promise<History> {
  if (a.price_source === "ft") {
    if (!a.isin) throw new Error("Financial Times needs the asset's ISIN");
    return fetchFtHistory(a.isin, from, a.currency);
  }
  if (!a.ticker) throw new Error("The Yahoo symbol is missing: add it in Settings → Edit");
  return fetchHistory(a.ticker, from);
}

export async function updatePrices(admin: SupabaseClient, userId?: string): Promise<Result[]> {
  let query = admin
    .from("assets")
    .select("id, name, ticker, isin, currency, price_source, asset_types!inner(valuation)")
    .eq("asset_types.valuation", "market")
    .neq("price_source", "manual");
  if (userId) query = query.eq("user_id", userId);

  const { data: assets, error } = await query;
  if (error) throw new Error(error.message);

  const results: Result[] = [];

  for (const a of assets ?? []) {
    try {
      // From when to download: a few days before the last saved price,
      // or from the first activity, or (if there's nothing) the last 30 days
      const [{ data: last }, { data: first }] = await Promise.all([
        admin.from("latest_prices").select("date").eq("asset_id", a.id).maybeSingle(),
        admin
          .from("transactions")
          .select("date")
          .eq("asset_id", a.id)
          .order("date")
          .limit(1)
          .maybeSingle(),
      ]);
      const base = last?.date ?? first?.date;
      const from = base
        ? new Date(new Date(base).getTime() - 5 * DAY_MS)
        : new Date(Date.now() - 30 * DAY_MS);

      const assetCurrency = a.currency ?? "EUR";
      const { currency, prices } = await download({ ...a, currency: assetCurrency }, from);
      if (currency && currency !== assetCurrency) {
        throw new Error(
          `${a.ticker} trades in ${currency} and the asset is in ${assetCurrency}: choose a symbol in ${assetCurrency}`,
        );
      }
      if (prices.length === 0) throw new Error("The source returned no prices");

      // We save in blocks (if there was already a price that day, it's replaced)
      for (let i = 0; i < prices.length; i += 500) {
        const rows = prices
          .slice(i, i + 500)
          .map((p) => ({ asset_id: a.id, date: p.date, price: p.price }));
        const { error: e } = await admin
          .from("prices")
          .upsert(rows, { onConflict: "asset_id,date" });
        if (e) throw new Error(e.message);
      }

      await admin
        .from("assets")
        .update({ price_status: null, price_updated_at: new Date().toISOString() })
        .eq("id", a.id);
      results.push({ name: a.name, added: prices.length, error: null });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await admin.from("assets").update({ price_status: message }).eq("id", a.id);
      results.push({ name: a.name, added: 0, error: message });
    }
    await wait(400); // so we don't overload the sources
  }

  return results;
}
