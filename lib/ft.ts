// Fund prices from Financial Times (markets.ft.com), searching by ISIN.
// It isn't an official API: we read its historical prices page. If it ever changes,
// only this file would need adjusting.
import type { History, DayPrice } from "@/lib/yahoo";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
};

const MONTHS: Record<string, string> = {
  January: "01",
  February: "02",
  March: "03",
  April: "04",
  May: "05",
  June: "06",
  July: "07",
  August: "08",
  September: "09",
  October: "10",
  November: "11",
  December: "12",
};

const DAY_MS = 24 * 60 * 60 * 1000;

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Financial Times answered ${r.status}`);
  return r.text();
}

const withoutTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Reads the <tr> rows of the history table: date (column 1) and close (column 5)
export function parseFtRows(html: string): DayPrice[] {
  const prices: DayPrice[] = [];
  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 5) continue;
    const f = withoutTags(cells[0]).match(/([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
    if (!f || !MONTHS[f[1]]) continue;
    const price = Number(withoutTags(cells[4]).replace(/,/g, ""));
    if (!Number.isFinite(price) || price <= 0) continue;
    prices.push({ date: `${f[3]}-${MONTHS[f[1]]}-${f[2].padStart(2, "0")}`, price });
  }
  return prices;
}

// Finds FT's internal identifier ("xid") and the fund name on its page
export function parseFtPage(html: string): { xid: string | null; name: string } {
  const xid = html.match(/xid(?:&quot;|")\s*:\s*(?:&quot;|")?(\d+)/)?.[1] ?? null;
  const name = withoutTags(
    html.match(/mod-tearsheet-overview__header__name[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "",
  );
  return { xid, name };
}

const ftDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "/");

// Daily prices of a fund by its ISIN, from a date until today
export async function fetchFtHistory(
  isin: string,
  from: Date,
  currency = "EUR",
): Promise<History & { name: string }> {
  const symbol = `${isin}:${currency}`;
  const page = await fetchText(
    `https://markets.ft.com/data/funds/tearsheet/historical?s=${encodeURIComponent(symbol)}`,
  );
  const { xid, name } = parseFtPage(page);
  if (!xid) {
    throw new Error(`Financial Times can't find ISIN ${isin} in ${currency}`);
  }

  // The page itself already has the last few days
  const byDate = new Map<string, number>();
  for (const p of parseFtRows(page)) byDate.set(p.date, p.price);

  // History is requested in chunks of one year at most
  const today = new Date();
  for (let start = from; start < today; start = new Date(start.getTime() + 365 * DAY_MS)) {
    const end = new Date(Math.min(start.getTime() + 364 * DAY_MS, today.getTime()));
    try {
      const text = await fetchText(
        `https://markets.ft.com/data/equities/ajax/get-historical-prices` +
          `?startDate=${ftDate(start)}&endDate=${ftDate(end)}&symbol=${xid}`,
      );
      const html = (JSON.parse(text) as { html?: string }).html ?? "";
      for (const p of parseFtRows(html)) byDate.set(p.date, p.price);
    } catch {
      // If a chunk fails we keep going: at least we save what does arrive
    }
  }

  const fromText = from.toISOString().slice(0, 10);
  const prices = [...byDate.entries()]
    .filter(([date]) => date >= fromText)
    .map(([date, price]) => ({ date, price }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { currency, prices, name };
}
