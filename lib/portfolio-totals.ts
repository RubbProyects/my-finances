// Portfolio totals. A pure function, so it can be tested without the database.
import type { PortfolioRow } from "@/lib/portfolio";

// Portfolio totals (only counts assets that already have a price).
// The % is over the money you really put in: what came from a fund switch was already counted
// when you bought the fund you switched out of, so it is taken off (otherwise it counts twice).
export function portfolioTotals(rows: PortfolioRow[]) {
  const withPrice = rows.filter((f) => f.value !== null);
  const value = withPrice.reduce((s, f) => s + (f.value ?? 0), 0);
  const bought = withPrice.reduce((s, f) => s + f.pos.bought - f.switchedIn, 0);
  const gain = withPrice.reduce((s, f) => s + (f.gain ?? 0), 0);
  return {
    value,
    gain,
    pct: bought > 0 ? (gain / bought) * 100 : null,
    noPrice: rows.length - withPrice.length,
  };
}
