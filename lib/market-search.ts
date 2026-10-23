// Universal search: finds an asset in EVERY market where it trades (London, Xetra, Amsterdam,
// Milan, Dublin...), because the same ETF has a different ticker, currency and price in each one.
// Server only. It combines Yahoo (search by name, symbol or ISIN) with the Financial Times
// listing (which lists all the venues of an ISIN) and checks each candidate on Yahoo to get its
// real currency and price. Funds that Yahoo doesn't have come from the Financial Times.
import { fetchFtHistory } from "@/lib/ft";
import { fetchMarketChart, searchSymbols } from "@/lib/yahoo";

export type MarketResult = {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  source: "yahoo" | "ft";
  currency: string | null;
  price: number | null;
};

// Financial Times exchange code -> Yahoo suffix and name
const FT_EXCHANGES: Record<string, { suffix: string; label: string }> = {
  LSE: { suffix: ".L", label: "London" },
  GER: { suffix: ".DE", label: "Xetra" },
  FRA: { suffix: ".F", label: "Frankfurt" },
  MIL: { suffix: ".MI", label: "Milan" },
  AEX: { suffix: ".AS", label: "Amsterdam" },
  PAR: { suffix: ".PA", label: "Paris" },
  SWX: { suffix: ".SW", label: "Switzerland" },
  MCE: { suffix: ".MC", label: "Madrid" },
  ISE: { suffix: ".IR", label: "Dublin" },
  VIE: { suffix: ".VI", label: "Vienna" },
  BRU: { suffix: ".BR", label: "Brussels" },
  LIS: { suffix: ".LS", label: "Lisbon" },
  STO: { suffix: ".ST", label: "Stockholm" },
  CPH: { suffix: ".CO", label: "Copenhagen" },
  HEL: { suffix: ".HE", label: "Helsinki" },
  OSL: { suffix: ".OL", label: "Oslo" },
  TOR: { suffix: ".TO", label: "Toronto" },
};

const FUND_ISIN =/^[A-Z]{2}[A-Z0-9]{9}[0-9]:[A-Z]{3}$/;
const MAX_RESULTS = 40;

type FtSecurity = { symbol: string; name: string; assetClass: string };

async function ftSearch(query: string): Promise<FtSecurity[]> {
  try {
    const r = await fetch(
      `https://markets.ft.com/data/searchapi/searchsecurities?query=${encodeURIComponent(query)}`,
      {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!r.ok) return [];
    const json = (await r.json()) as { data?: { security?: FtSecurity[] } };
    return json.data?.security ?? [];
  } catch {
    return [];
  }
}

const base = (symbol: string) => symbol.toUpperCase().split(".")[0];

// Words too generic to tell two products apart
const GENERIC = new Set(["ucits", "etf", "fund", "acc", "dist", "usd", "eur", "gbp", "the", "and", "index", "class", "shares"]);
const words = (name: string) =>
  new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9&]+/)
      .filter((w) => w.length >= 3 && !GENERIC.has(w)),
  );
function sharesWord(a: string, b: string): boolean {
  if (!a || !b) return true; // a name is missing: nothing to compare
  const wa = words(a);
  return [...words(b)].some((w) => wa.has(w));
}

export async function searchMarkets(query: string): Promise<MarketResult[]> {
  const [yahoo, ft] = await Promise.all([searchSymbols(query, 25).catch(() => []), ftSearch(query)]);

  const found = new Map<string, MarketResult>();
  const add = (r: MarketResult) => {
    const key = `${r.source}:${r.symbol}`;
    if (!found.has(key)) found.set(key, r);
  };
  // What Yahoo itself returned comes first and is kept even if its price can't be checked
  const native = new Set<string>();
  for (const c of yahoo) {
    add({ ...c, source: "yahoo", currency: null, price: null });
    native.add(`yahoo:${c.symbol}`);
  }

  // The Financial Times lists the venues of an ETF or stock, and the funds Yahoo may not have
  for (const s of ft) {
    const [ticker, exch, ccy] = s.symbol.split(":");
    if (s.assetClass === "Funds" && FUND_ISIN.test(s.symbol)) {
      add({
        symbol: s.symbol,
        name: s.name,
        exchange: "Financial Times",
        type: "Fund",
        source: "ft",
        currency: ccy ?? exch ?? null,
        price: null,
      });
    } else if ((s.assetClass === "ETFs" || s.assetClass === "Equities") && FT_EXCHANGES[exch]) {
      const { suffix, label } = FT_EXCHANGES[exch];
      add({
        symbol: `${ticker}${suffix}`,
        name: s.name,
        exchange: label,
        type: s.assetClass === "ETFs" ? "ETF" : "Equity",
        source: "yahoo",
        currency: ccy ?? null,
        price: null,
      });
    }
  }

  // The same ticker on other exchanges (XMLD.DE also exists in Munich, London...)
  const bases = [
    ...new Set(
      [...found.values()]
        .filter((r) => r.source === "yahoo" && /^[A-Z0-9]{2,6}$/.test(base(r.symbol)))
        .map((r) => base(r.symbol)),
    ),
  ].slice(0, 4);
  const siblings = await Promise.all(bases.map((b) => searchSymbols(b, 25).catch(() => [])));
  // Another company can use the same ticker (AIAI also exists on NASDAQ, XMLD in London is a
  // different ETF): a sibling listing must be the same kind of product, and it is only kept
  // after its price is checked below
  const seeds = [...found.values()];
  const siblingKeys = new Set<string>();
  siblings.forEach((list, i) => {
    const known = seeds.filter((r) => base(r.symbol) === bases[i]);
    for (const c of list) {
      if (base(c.symbol) !== bases[i] || found.has(`yahoo:${c.symbol}`)) continue;
      if (known.some((k) => !k.type || !c.type || k.type === c.type)) {
        add({ ...c, source: "yahoo", currency: null, price: null });
        siblingKeys.add(`yahoo:${c.symbol}`);
      }
    }
  });

  // Check each candidate: real currency and latest price. Those that Yahoo doesn't know are dropped
  // (unless Yahoo itself offered them).
  const candidates = [...found.values()].slice(0, MAX_RESULTS);
  const ftChecked = new Set(candidates.filter((r) => r.source === "ft").slice(0, 8));
  const checked = await Promise.all(
    candidates.map(async (r): Promise<MarketResult | null> => {
      try {
        if (r.source === "yahoo") {
          const c = await fetchMarketChart(r.symbol, "5d");
          return { ...r, name: r.name || c.name, currency: c.currency, price: c.price };
        }
        if (!ftChecked.has(r)) return r;
        const [isin, ccy] = r.symbol.split(":");
        const h = await fetchFtHistory(isin, new Date(Date.now() - 10 * 86400000), ccy);
        const last = h.prices[h.prices.length - 1];
        return last ? { ...r, price: last.price } : null;
      } catch {
        return native.has(`${r.source}:${r.symbol}`) ? r : null;
      }
    }),
  );
  const results = checked.filter((r): r is MarketResult => r !== null);

  // A sibling is the same product if it trades at about the same price as the known listings in
  // the same currency (within 25%). With nothing to compare against, its name has to share a word.
  const known = results.filter((r) => !siblingKeys.has(`${r.source}:${r.symbol}`));
  return results.filter((r) => {
    if (!siblingKeys.has(`${r.source}:${r.symbol}`)) return true;
    const refs = known
      .filter((k) => k.price !== null && k.currency === r.currency && base(k.symbol) === base(r.symbol))
      .map((k) => k.price as number)
      .sort((x, y) => x - y);
    if (r.price !== null && refs.length > 0 && r.currency !== "GBp") {
      const median = refs[refs.length >> 1];
      return r.price >= median * 0.8 && r.price <= median * 1.25;
    }
    return known.some((k) => base(k.symbol) === base(r.symbol) && sharesWord(k.name, r.name));
  });
}
