// Market data for the Markets tab, from Yahoo (stocks, ETFs, crypto) or Financial Times (funds by ISIN).
// Server only: the browser asks for it through app/api/market.
import { fetchFtHistory } from "@/lib/ft";
import { fetchMarketChart, type ChartRange, type MarketChart } from "@/lib/yahoo";

export type MarketSource = "yahoo" | "ft";

const DAY = 24 * 60 * 60 * 1000;
const FT_DAYS: Record<ChartRange, number> = {
  "1d": 7,
  "5d": 10,
  "1m": 32,
  "6m": 185,
  "1y": 367,
  "5y": 5 * 365 + 2,
  max: 5 * 365 + 2,
};

export const isIsin = (t: string) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(t);

export function parseRange(value: string | null): ChartRange {
  return value && value in FT_DAYS ? (value as ChartRange) : "6m";
}

export async function marketChart(
  symbol: string,
  source: MarketSource,
  range: ChartRange,
): Promise<MarketChart> {
  if (source === "yahoo") return fetchMarketChart(symbol, range);

  // A fund only has one value per day, so the 1 day range shows its last week.
  // Its symbol is "ISIN:CURRENCY" (the same fund can exist in several currencies).
  const [isin, currency] = symbol.toUpperCase().split(":");
  const h = await fetchFtHistory(isin, new Date(Date.now() - FT_DAYS[range] * DAY), currency || "EUR");
  const points = h.prices.map((p) => ({ t: new Date(`${p.date}T00:00:00Z`).getTime(), value: p.price }));
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  return {
    symbol: symbol.toUpperCase(),
    name: h.name || symbol.toUpperCase(),
    exchange: "Financial Times",
    type: "FUND",
    currency: h.currency,
    price: last?.value ?? null,
    previousClose: prev?.value ?? null,
    points,
  };
}
