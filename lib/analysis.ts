// Analysis calculations: daily evolution of the portfolio and returns by period.
// They're pure functions (no database), so they're easy to test.

export type Op = {
  asset_id: string;
  date: string;
  type: "buy" | "sell" | "dividend" | "split";
  amount: number;
  fee: number;
  withholding: number;
  units: number | null;
  factor: number | null;
};

export type DayPrice = { date: string; price: number };

export type AssetInfo = { id: string; name: string; price_source: string };

export type SeriesPoint = { date: string; value: number; contributed: number };

// Adds days to a "YYYY-MM-DD" date
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000,
  );
}

// Last price on or before a date (if there's none yet, the first one available)
function priceAt(prices: DayPrice[], date: string): number | null {
  if (prices.length === 0) return null;
  let low = 0;
  let height = prices.length - 1;
  let res = -1;
  while (low <= height) {
    const middle = (low + height) >> 1;
    if (prices[middle].date <= date) {
      res = middle;
      low = middle + 1;
    } else {
      height = middle - 1;
    }
  }
  return prices[res >= 0 ? res : 0].price;
}

// Value of an asset at the end of a day.
// Yahoo returns old prices already adjusted for splits; so, for its assets,
// we multiply by the splits that happened after that day.
export function assetValueAt(
  asset: AssetInfo,
  ops: Op[],
  prices: DayPrice[],
  date: string,
): number {
  let unitCount = 0;
  let adjustment = 1;
  for (const o of ops) {
    if (o.asset_id !== asset.id) continue;
    const p = Number(o.units ?? 0);
    if (o.date <= date) {
      if (o.type === "buy" || o.type === "split") unitCount += p;
      if (o.type === "sell") unitCount -= p;
    } else if (o.type === "split" && asset.price_source === "yahoo") {
      adjustment *= Number(o.factor ?? 1);
    }
  }
  if (unitCount <= 1e-9) return 0;
  const price = priceAt(prices, date);
  return price === null ? 0 : unitCount * price * adjustment;
}

// Money that goes into the portfolio with an activity (+) or comes out (−)
export function flow(o: Op): number {
  if (o.type === "buy") return Number(o.amount) + Number(o.fee);
  if (o.type === "sell") return -(Number(o.amount) - Number(o.fee));
  if (o.type === "dividend") return -(Number(o.amount) - Number(o.withholding) - Number(o.fee));
  return 0;
}

// Daily series of the portfolio value and the money contributed (buys − sells)
export function portfolioSeries(
  assets: AssetInfo[],
  ops: Op[],
  prices: Map<string, DayPrice[]>,
  from: string,
  until: string,
): SeriesPoint[] {
  const series: SeriesPoint[] = [];
  for (let day = from; day <= until; day = addDays(day, 1)) {
    const value = assets.reduce((s, a) => s + assetValueAt(a, ops, prices.get(a.id) ?? [], day), 0);
    const contributed = ops
      .filter((o) => o.date <= day && (o.type === "buy" || o.type === "sell"))
      .reduce((s, o) => s + flow(o), 0);
    series.push({ date: day, value, contributed });
  }
  return series;
}

// Return over a period with the Modified Dietz method: it discounts the money
// you put in or take out during the period, weighted by the days it was invested.
export function periodReturn(
  v0: number,
  v1: number,
  ops: Op[],
  from: string,
  until: string,
): { gain: number; pct: number | null } {
  const start = addDays(from, -1);
  const total = Math.max(daysBetween(start, until), 1);
  let flows = 0;
  let weighted = 0;
  let invested = 0;
  for (const o of ops) {
    if (o.date < from || o.date > until) continue;
    const f = flow(o);
    flows += f;
    weighted += f * (daysBetween(o.date, until) / total);
    if (f > 0) invested += f;
  }
  const gain = v1 - v0 - flows;
  // If nothing was invested at the start, the % is over what you put in (more intuitive)
  const base = v0 > 0.01 ? v0 + weighted : invested;
  return { gain, pct: base > 0.01 ? (gain / base) * 100 : null };
}

export type DayChange = {
  gain: number; // how much it went up (+) or down (−) in €
  pct: number | null;
  base: number; // what it was worth at the previous price
  date: string; // the day of the latest price
  previous: string; // the day of the previous price
};

// How much an asset went up or down on its last day with a price (from the previous price to
// the latest, like brokers' "today"). If you bought or sold in between, that doesn't count
// as a gain (same method as the returns).
export function dayChange(
  asset: AssetInfo,
  ops: Op[],
  prices: DayPrice[],
  today: string,
): DayChange | null {
  const until = prices.filter((p) => p.date <= today);
  if (until.length < 2) return null;
  const date = until[until.length - 1].date;
  const previous = until[until.length - 2].date;
  const own = ops.filter((o) => o.asset_id === asset.id);
  const v0 = assetValueAt(asset, own, until, previous);
  const v1 = assetValueAt(asset, own, until, today);
  if (v0 === 0 && v1 === 0) return null;
  const r = periodReturn(v0, v1, own, addDays(previous, 1), today);
  return { gain: r.gain, pct: r.pct, base: v0, date, previous };
}

// The sum of several assets' day changes
export function totalDayChange(changes: DayChange[]): { gain: number; pct: number | null } {
  const gain = changes.reduce((s, c) => s + c.gain, 0);
  const base = changes.reduce((s, c) => s + c.base, 0);
  return { gain, pct: base > 0.01 ? (gain / base) * 100 : null };
}
