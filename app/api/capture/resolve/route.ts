// Called from Settings after assigning a card to an account: records the expenses that were
// waiting for that card and pairs the waiting ones with the bank inbox.
import { reconcileCaptures, resolveUnmapped } from "@/lib/capture-server";
import { requestUser, supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const userId = await requestUser(request);
    if (!userId) return Response.json({ error: "Sign in again" }, { status: 401 });
    const admin = supabaseAdmin();
    const recorded = await resolveUnmapped(admin, userId);
    const { matched } = await reconcileCaptures(admin, userId);
    return Response.json({ recorded, matched });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
