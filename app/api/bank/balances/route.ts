// "Compare with the bank balance" button: the balance the bank reports for each account
import { userHeaders } from "@/lib/enable-banking";
import { supabaseAdmin, requestUser } from "@/lib/supabase-admin";
import { bankBalances } from "@/lib/fetch-bank";

export async function GET(request: Request) {
  try {
    const userId = await requestUser(request);
    if (!userId) return Response.json({ error: "Sign in again" }, { status: 401 });
    const balances = await bankBalances(supabaseAdmin(), userId, userHeaders(request));
    return Response.json({ balances });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ error }, { status: 500 });
  }
}
