// Route called by Vercel Cron once a day (see vercel.json).
// Updates prices and fetches the bank transactions (and records automatically those with a rule).
// Vercel sends "Authorization: Bearer <CRON_SECRET>"; without it, nothing runs.
import { updatePrices } from "@/lib/update-prices";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchAllUsers } from "@/lib/fetch-bank";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Prices first and then the bank: if one fails, the other one still runs
  const admin = supabaseAdmin();
  const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
  let failed = false;
  let results: unknown;
  let bank: unknown;
  try {
    results = await updatePrices(admin);
  } catch (e) {
    results = { error: messageOf(e) };
    failed = true;
  }
  try {
    bank = await fetchAllUsers(admin);
  } catch (e) {
    bank = { error: messageOf(e) };
    failed = true;
  }
  return Response.json({ results, bank }, { status: failed ? 500 : 200 });
}
