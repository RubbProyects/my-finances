// "Fetch transactions" button: downloads the signed-in user's bank accounts
import { userHeaders } from "@/lib/enable-banking";
import { supabaseAdmin, requestUser } from "@/lib/supabase-admin";
import { fetchMovements } from "@/lib/fetch-bank";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const userId = await requestUser(request);
    if (!userId) return Response.json({ error: "Sign in again" }, { status: 401 });
    return Response.json(await fetchMovements(supabaseAdmin(), userId, userHeaders(request)));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ error }, { status: 500 });
  }
}
