// Refreshes the prices by itself when the app is open and they're old enough (the hourly timer
// covers the rest of the time). The "Update prices" button still updates everything on demand.
import { callApi } from "@/lib/api";
import { isStale } from "@/lib/prices-info";
import { supabase } from "@/lib/supabase";

const MIN_BETWEEN_ATTEMPTS_MS = 10 * 60 * 1000;
let lastAttempt = 0;

// True if some price was updated (so the screen can reload)
export async function refreshIfStale(): Promise<boolean> {
  // Marked before anything is awaited, so two calls at the same time (React mounts twice in
  // development) only do the work once. Even if it fails, it isn't tried again for a while.
  if (Date.now() - lastAttempt < MIN_BETWEEN_ATTEMPTS_MS) return false;
  lastAttempt = Date.now();
  const { data, error } = await supabase
    .from("assets")
    .select("price_updated_at, price_source, asset_types!inner(valuation)")
    .eq("asset_types.valuation", "market")
    .neq("price_source", "manual");
  if (error) return false;
  const now = Date.now();
  const rows = (data ?? []) as { price_updated_at: string | null; price_source: string }[];
  if (!rows.some((r) => isStale(r.price_updated_at, r.price_source, now))) return false;

  try {
    const r = await callApi<{ results: { error: string | null }[] }>("/api/prices?stale=1", "POST");
    return r.results.some((x) => !x.error);
  } catch {
    return false;
  }
}
