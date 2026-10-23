// Latest price, daily change and one month of trend for several favorites at once.
// Called every few seconds from Markets to keep the list live.
import type { NextRequest } from "next/server";
import { marketChart, type MarketSource } from "@/lib/market";
import { requestUser } from "@/lib/supabase-admin";

export type Quote = {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  currency: string | null;
  trend: number[];
  error?: string;
};

export async function GET(request: NextRequest) {
  try {
    if (!(await requestUser(request))) {
      return Response.json({ error: "Sign in again" }, { status: 401 });
    }
    // Format: symbol:source,symbol:source (at most 30). The source is after the LAST colon
    // because a Financial Times fund's symbol has one too ("ISIN:EUR").
    const items = (request.nextUrl.searchParams.get("items") ?? "")
      .split(",")
      .map((s) => {
        const i = s.lastIndexOf(":");
        return i < 0 ? [s, "yahoo"] : [s.slice(0, i), s.slice(i + 1)];
      })
      .filter(([symbol]) => symbol)
      .slice(0, 30);

    const quotes: Quote[] = await Promise.all(
      items.map(async ([symbol, source]) => {
        try {
          const c = await marketChart(symbol, source === "ft" ? "ft" : ("yahoo" as MarketSource), "1m");
          return {
            symbol,
            price: c.price,
            previousClose: c.previousClose,
            currency: c.currency,
            trend: c.points.map((p) => p.value),
          };
        } catch (e) {
          return {
            symbol,
            price: null,
            previousClose: null,
            currency: null,
            trend: [],
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );
    return Response.json({ quotes });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
