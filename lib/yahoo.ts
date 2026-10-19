// Price downloads and symbol search on Yahoo Finance (free, unofficial).
// If it ever stops working, only this file would need changing.

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
};

async function fetchJson(path: string): Promise<unknown> {
  let lastError = "";
  for (const server of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${server}.finance.yahoo.com${path}`, {
        headers: HEADERS,
        cache: "no-store",
      });
      if (r.ok) return await r.json();
      lastError = `Yahoo answered ${r.status}`;
      if (r.status === 404) break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastError || "Couldn't reach Yahoo");
}

export type DayPrice = { date: string; price: number };
export type History = { currency: string | null; prices: DayPrice[] };

type ChartResponse = {
  chart?: {
    error?: { description?: string } | null;
    result?: {
      meta?: {
        currency?: string;
        gmtoffset?: number;
        regularMarketPrice?: number;
        regularMarketTime?: number;
      };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
};

// Turns Yahoo's response into a list of {fecha, precio} (one price per day)
export function parseHistory(json: ChartResponse): History {
  const error = json.chart?.error;
  if (error) throw new Error(error.description ?? "Symbol not found");
  const r = json.chart?.result?.[0];
  if (!r) throw new Error("Symbol not found on Yahoo");

  const lag = r.meta?.gmtoffset ?? 0;
  const toDate = (t: number) => new Date((t + lag) * 1000).toISOString().slice(0, 10);

  const byDate = new Map<string, number>();
  const closes = r.indicators?.quote?.[0]?.close ?? [];
  (r.timestamp ?? []).forEach((t, i) => {
    const p = closes[i];
    if (typeof p === "number" && p > 0) byDate.set(toDate(t), p);
  });

  // The most recent price (may be today's, not yet closed)
  const { regularMarketPrice: current, regularMarketTime: time } = r.meta ?? {};
  if (typeof current === "number" && current > 0 && typeof time === "number") {
    byDate.set(toDate(time), current);
  }

  const prices = [...byDate.entries()]
    .map(([date, price]) => ({ date, price }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { currency: r.meta?.currency ?? null, prices };
}

// Daily prices of a symbol from a date until today
export async function fetchHistory(symbol: string, from: Date): Promise<History> {
  const p1 = Math.floor(from.getTime() / 1000);
  const p2 = Math.floor(Date.now() / 1000);
  const json = await fetchJson(
    `/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`,
  );
  return parseHistory(json as ChartResponse);
}

export type Candidate = {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
};

// Finds symbols from an ISIN or a text (e.g. "bitcoin")
export async function searchSymbols(query: string): Promise<Candidate[]> {
  const json = (await fetchJson(
    `/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&listsCount=0`,
  )) as {
    quotes?: {
      symbol?: string;
      shortname?: string;
      longname?: string;
      exchDisp?: string;
      exchange?: string;
      typeDisp?: string;
      quoteType?: string;
    }[];
  };
  return (json.quotes ?? [])
    .filter((q) => q.symbol)
    .map((q) => ({
      symbol: q.symbol as string,
      name: q.longname ?? q.shortname ?? "",
      exchange: q.exchDisp ?? q.exchange ?? "",
      type: q.typeDisp ?? q.quoteType ?? "",
    }));
}
