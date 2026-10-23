// When the prices were last updated, and whether an asset's price is old enough to refresh.
// No imports from the app, so the server and the browser can both use it.

const MINUTE = 60 * 1000;

// How old a price can get before the hourly refresh (or opening the app) updates it again.
// Yahoo moves all day; a fund from Financial Times only publishes once a day.
export const MAX_AGE_MS: Record<string, number> = {
  yahoo: 50 * MINUTE,
  ft: 6 * 60 * MINUTE,
};

export function isStale(updatedAt: string | null, source: string, now: number): boolean {
  if (!updatedAt) return true;
  const time = new Date(updatedAt).getTime();
  if (!Number.isFinite(time)) return true;
  return now - time >= (MAX_AGE_MS[source] ?? MAX_AGE_MS.yahoo);
}

export type PricesInfo = {
  oldest: string | null; // the oldest update among the automatic assets
  assets: number; // how many assets have an automatic source
};

// The oldest of the dates: if one asset is behind, that is the honest "last update"
export function summarizeUpdates(
  rows: { price_updated_at: string | null }[],
): PricesInfo {
  if (rows.length === 0) return { oldest: null, assets: 0 };
  let oldest: string | null = null;
  for (const r of rows) {
    if (!r.price_updated_at) return { oldest: null, assets: rows.length };
    if (oldest === null || r.price_updated_at < oldest) oldest = r.price_updated_at;
  }
  return { oldest, assets: rows.length };
}
