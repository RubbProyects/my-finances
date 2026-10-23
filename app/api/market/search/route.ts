// Searches any stock, ETF, fund or crypto by name, symbol or ISIN (Yahoo, and Financial Times for funds).
import type { NextRequest } from "next/server";
import { isIsin, marketChart } from "@/lib/market";
import { requestUser } from "@/lib/supabase-admin";
import { searchSymbols } from "@/lib/yahoo";

export type MarketResult = {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  source: "yahoo" | "ft";
};

export async function GET(request: NextRequest) {
  try {
    if (!(await requestUser(request))) {
      return Response.json({ error: "Sign in again" }, { status: 401 });
    }
    const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return Response.json({ results: [] });

    const results: MarketResult[] = (await searchSymbols(q).catch(() => []))
      .slice(0, 10)
      .map((c) => ({ ...c, source: "yahoo" as const }));

    // Many funds aren't on Yahoo: if it's an ISIN with no result, Financial Times is tried
    if (isIsin(q) && results.length === 0) {
      try {
        const fund = await marketChart(q, "ft", "1m");
        if (fund.price !== null) {
          results.push({
            symbol: fund.symbol,
            name: fund.name,
            exchange: "Financial Times",
            type: "Fund",
            source: "ft",
          });
        }
      } catch {
        // No fund with that ISIN either
      }
    }
    return Response.json({ results });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
