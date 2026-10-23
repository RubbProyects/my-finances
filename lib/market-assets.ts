// From Markets to your portfolio: finds the asset you already have for a listing, or creates it,
// so there is no need to create assets by hand before the first purchase.
// No imports from the app except the database client, so the choices can be tested.
import { supabase } from "@/lib/supabase";

export type Listing = {
  symbol: string; // Yahoo symbol, or "ISIN:CURRENCY" for a Financial Times fund
  name: string;
  source: "yahoo" | "ft";
  currency: string | null;
  type: string | null; // Yahoo's instrument type
};

// The app only handles euros (see "Currency" in the rules): only listings in euros can be recorded
export const isEuroListing = (currency: string | null) => currency === "EUR";

// Which of the 11 base asset types a listing is
export function baseKeyFor(l: Pick<Listing, "source" | "type">): "etf" | "stock" | "crypto" | "fund" {
  if (l.source === "ft") return "fund";
  switch ((l.type ?? "").toUpperCase()) {
    case "ETF":
      return "etf";
    case "CRYPTOCURRENCY":
      return "crypto";
    case "MUTUALFUND":
      return "fund";
    default:
      return "stock";
  }
}

// The asset you already have for this listing (or null)
export async function findAsset(l: Listing): Promise<string | null> {
  const q = supabase.from("assets").select("id");
  const { data } =
    l.source === "ft"
      ? await q.eq("price_source", "ft").eq("isin", l.symbol.split(":")[0]).limit(1)
      : await q.eq("price_source", "yahoo").eq("ticker", l.symbol).limit(1);
  return data?.[0]?.id ?? null;
}

// Returns the asset id (existing or new) or an error text
export async function findOrCreateAsset(
  l: Listing,
  platformId: string | null,
): Promise<{ id: string } | { error: string }> {
  const existing = await findAsset(l);
  if (existing) return { id: existing };

  const key = baseKeyFor(l);
  const { data: type } = await supabase.from("asset_types").select("id").eq("base_key", key).limit(1);
  const typeId = type?.[0]?.id;
  if (!typeId) return { error: `Asset type "${key}" not found: open Settings once so it is created` };

  const { data, error } = await supabase
    .from("assets")
    .insert({
      name: l.name,
      type_id: typeId,
      platform_id: platformId,
      currency: "EUR",
      isin: l.source === "ft" ? l.symbol.split(":")[0] : null,
      ticker: l.source === "yahoo" ? l.symbol : null,
      price_source: l.source,
    })
    .select("id")
    .single();
  return error || !data ? { error: error?.message ?? "Couldn't create the asset" } : { id: data.id };
}
