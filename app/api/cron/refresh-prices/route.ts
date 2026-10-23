// Hourly price refresh, called by a GitHub Actions timer (.github/workflows/refresh-prices.yml):
// Vercel's free plan only allows one cron a day (the daily one is in vercel.json).
// It ONLY updates prices that are old enough, and never touches the bank: banks allow very few
// automatic reads per day.
// It needs "Authorization: Bearer <CRON_SECRET>"; without it, nothing runs.
import { DEMO } from "@/lib/demo";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { updatePrices } from "@/lib/update-prices";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // The demo's prices are reset every night: it isn't refreshed hourly
  if (DEMO) return Response.json({ skipped: "demo" });
  try {
    const results = await updatePrices(supabaseAdmin(), undefined, { staleOnly: true });
    const failed = results.filter((r) => r.error).length;
    return Response.json({ updated: results.length - failed, failed, results }, { status: failed === results.length && failed > 0 ? 500 : 200 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
