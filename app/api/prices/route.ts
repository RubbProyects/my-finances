// "Update prices now" button: updates only the signed-in user's assets
import { updatePrices } from "@/lib/update-prices";
import { supabaseAdmin, requestUser } from "@/lib/supabase-admin";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const userId = await requestUser(request);
    if (!userId) {
      return Response.json({ error: "Sign in again" }, { status: 401 });
    }
    const results = await updatePrices(supabaseAdmin(), userId);
    return Response.json({ results });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ error }, { status: 500 });
  }
}
