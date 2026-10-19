// Searches Yahoo for the symbols of an ISIN (or text) and checks the currency and latest price.
// Yahoo sometimes only returns the main exchange (e.g. London in USD), so we also
// try that same symbol on the European exchanges in euros (Amsterdam, Xetra...).
import type { NextRequest } from "next/server";
import { requestUser } from "@/lib/supabase-admin";
import { fetchFtHistory } from "@/lib/ft";
import { searchSymbols, fetchHistory, type Candidate } from "@/lib/yahoo";

const EUR_EXCHANGES: Record<string, string> = {
  ".AS": "Amsterdam",
  ".DE": "Xetra (Germany)",
  ".MI": "Milan",
  ".PA": "Paris",
  ".F": "Frankfurt",
};

const isIsin = (t: string) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(t);
const looksLikeSymbol = (t: string) => /^[A-Z0-9^=.-]{1,20}$/i.test(t) && !isIsin(t);

export async function GET(request: NextRequest) {
  try {
    const userId = await requestUser(request);
    if (!userId) {
      return Response.json({ error: "Sign in again" }, { status: 401 });
    }
    const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) {
      return Response.json({ error: "Enter an ISIN, a symbol or a name" }, { status: 400 });
    }

    // Financial Times: we check that the ISIN returns a price and show the fund's name
    if (request.nextUrl.searchParams.get("source") === "ft") {
      const isin = q.toUpperCase();
      try {
        const h = await fetchFtHistory(isin, new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));
        const latest = h.prices[h.prices.length - 1];
        if (!latest) throw new Error("Financial Times returned no recent prices");
        return Response.json({
          options: [
            {
              symbol: isin,
              name: `${h.name || "Fund"} · latest value: ${latest.date}`,
              exchange: "Financial Times",
              type: "",
              currency: h.currency,
              price: latest.price,
            },
          ],
        });
      } catch (e) {
        return Response.json(
          { error: e instanceof Error ? e.message : String(e) },
          { status: 404 },
        );
      }
    }

    const found = (await searchSymbols(q)).slice(0, 6);
    const candidates: Candidate[] = [...found];
    const alreadyListed = (s: string) => candidates.some((c) => c.symbol === s);

    // If what was typed already looks like a symbol (e.g. CSPX.AS), we try it as is
    const variants = new Set<string>();
    if (looksLikeSymbol(q) && !alreadyListed(q.toUpperCase())) {
      candidates.unshift({ symbol: q.toUpperCase(), name: "", exchange: "", type: "" });
      variants.add(q.toUpperCase());
    }

    // The same symbol on European exchanges in euros
    const baseSymbols = [
      ...new Set(
        [q, ...found.map((c) => c.symbol)]
          .filter(looksLikeSymbol)
          .map((s) => s.toUpperCase().split(".")[0]),
      ),
    ].slice(0, 2);
    for (const base of baseSymbols) {
      const name = found.find((c) => c.symbol.split(".")[0] === base)?.name ?? "";
      for (const [suffix, exchange] of Object.entries(EUR_EXCHANGES)) {
        const symbol = base + suffix;
        if (!alreadyListed(symbol)) {
          candidates.push({ symbol, name, exchange, type: "" });
          variants.add(symbol);
        }
      }
    }

    // We check the currency and latest price of each one
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const options = await Promise.all(
      candidates.map(async (c) => {
        try {
          const h = await fetchHistory(c.symbol, sevenDaysAgo);
          const latest = h.prices[h.prices.length - 1];
          return { ...c, currency: h.currency, price: latest?.price ?? null };
        } catch {
          return { ...c, currency: null, price: null };
        }
      }),
    );

    // Variants (and what was typed by hand) that don't exist on Yahoo are dropped; those trading in euros first
    const valid = options.filter((o) => !variants.has(o.symbol) || o.price !== null);
    valid.sort((a, b) => Number(b.currency === "EUR") - Number(a.currency === "EUR"));
    return Response.json({ options: valid });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ error }, { status: 500 });
  }
}
