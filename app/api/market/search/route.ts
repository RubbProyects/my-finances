// Searches any stock, ETF, fund or crypto by name, symbol or ISIN, in every market where it trades.
import type { NextRequest } from "next/server";
import { searchMarkets } from "@/lib/market-search";
import { requestUser } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  try {
    if (!(await requestUser(request))) {
      return Response.json({ error: "Sign in again" }, { status: 401 });
    }
    const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return Response.json({ results: [] });
    return Response.json({ results: await searchMarkets(q) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
