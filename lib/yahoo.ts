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

export const CHART_RANGES = {
  "1d": { range: "1d", interval: "5m" },
  "5d": { range: "5d", interval: "15m" },
  "1m": { range: "1mo", interval: "1d" },
  "6m": { range: "6mo", interval: "1d" },
  "1y": { range: "1y", interval: "1d" },
  "5y": { range: "5y", interval: "1wk" },
  max: { range: "max", interval: "1mo" },
} as const;
export type ChartRange = keyof typeof CHART_RANGES;

export type MarketChart = {
  symbol: string;
  name: string;
  exchange: string;
  // Yahoo's instrument type: ETF, EQUITY, CRYPTOCURRENCY, MUTUALFUND...
  type: string | null;
  currency: string | null;
  price: number | null;
  previousClose: number | null;
  // Time in milliseconds and value; intraday ranges have several points per day
  points: { t: number; value: number }[];
};

type MarketChartResponse = {
  chart?: {
    error?: { description?: string } | null;
    result?: {
      meta?: {
        symbol?: string;
        currency?: string;
        longName?: string;
        shortName?: string;
        exchangeName?: string;
        fullExchangeName?: string;
        instrumentType?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
      };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
};

// Chart of a symbol for a range (1 day with 5 minute points, up to the whole history)
export async function fetchMarketChart(symbol: string, range: ChartRange): Promise<MarketChart> {
  const { range: r, interval } = CHART_RANGES[range];
  const json = (await fetchJson(
    `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${r}&interval=${interval}`,
  )) as MarketChartResponse;
  const error = json.chart?.error;
  if (error) throw new Error(error.description ?? "Symbol not found");
  const res = json.chart?.result?.[0];
  if (!res) throw new Error("Symbol not found on Yahoo");

  const closes = res.indicators?.quote?.[0]?.close ?? [];
  const points: { t: number; value: number }[] = [];
  (res.timestamp ?? []).forEach((t, i) => {
    const v = closes[i];
    if (typeof v === "number" && v > 0) points.push({ t: t * 1000, value: v });
  });
  const meta = res.meta ?? {};
  return {
    symbol: meta.symbol ?? symbol,
    name: meta.longName ?? meta.shortName ?? symbol,
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? "",
    type: meta.instrumentType ?? null,
    currency: meta.currency ?? null,
    price: meta.regularMarketPrice ?? points[points.length - 1]?.value ?? null,
    previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
    points,
  };
}

export type Candidate = {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
};

// Finds symbols from an ISIN or a text (e.g. "bitcoin")
export async function searchSymbols(query: string, count = 10): Promise<Candidate[]> {
  const json = (await fetchJson(
    `/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=${count}&newsCount=0&listsCount=0`,
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
