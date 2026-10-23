// Chart and latest price of one symbol for a range (1d, 5d, 1m, 6m, 1y, 5y, max).
import type { NextRequest } from "next/server";
import { marketChart, parseRange, type MarketSource } from "@/lib/market";
import { requestUser } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  try {
    if (!(await requestUser(request))) {
      return Response.json({ error: "Sign in again" }, { status: 401 });
    }
    const p = request.nextUrl.searchParams;
    const symbol = p.get("symbol")?.trim() ?? "";
    if (!symbol) return Response.json({ error: "Missing symbol" }, { status: 400 });
    const source: MarketSource = p.get("source") === "ft" ? "ft" : "yahoo";
    return Response.json(await marketChart(symbol, source, parseRange(p.get("range"))));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
