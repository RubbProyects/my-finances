// Tax section: gains and losses of each sale by FIFO (what you bought first is what
// you sell first), fund switches that aren't taxed and dividends. For guidance only.
//
// - FIFO works by "homogeneous securities": the same ISIN counts as a single security even on
//   different platforms. Without an ISIN, each asset goes separately.
// - Cost of a buy = amount + fee. What you receive in a sale = amount − fee.
// - In a fund switch, the source fund's buys move to the target with their cost and date.

export type TaxOp = {
  id: string;
  asset_id: string;
  date: string;
  type: string;
  amount: number;
  fee: number;
  withholding: number;
  units: number | null;
  factor: number | null;
  switch_id: string | null;
};

export type TaxAsset = { id: string; isin: string | null };

// Part of a buy that's sold (or that you still hold)
export type Lot = {
  buy: string; // id of the buy it comes from
  asset_id: string; // where it is now (changes when switching)
  date: string; // date of the original buy
  units: number;
  cost: number;
};

export type TaxSale = {
  id: string;
  asset_id: string;
  date: string;
  units: number;
  proceeds: number; // what you receive: amount − fee
  acquisition: number; // what those units cost
  gain: number; // proceeds − acquisition (negative = loss)
  lots: { date: string; units: number; cost: number }[];
  missing: number; // units sold without a recorded buy (cost 0)
  twoMonths: boolean; // loss with buys of the same security 2 months before or after
};

export type TaxSwitch = {
  id: string; // id of the sale
  source: string;
  target: string;
  date: string;
  value: number; // euros switched
  cost: number; // cost carried by the target fund
  missing: number; // units that left without a recorded buy
};

export type TaxDividend = { asset_id: string; date: string; gross: number; withholding: number };

export type TaxReport = {
  sales: TaxSale[];
  switches: TaxSwitch[];
  dividends: TaxDividend[];
};

const MARGIN = 1e-9; // so we don't carry leftovers like 0.0000000001 units

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// "2026-03-31" + 2 months -> "2026-05-31" (if the day doesn't exist, the month's last day)
export function addMonths(date: string, months: number): string {
  const [a, m, d] = date.split("-").map(Number);
  const total = a * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// Takes "n" units from a queue of lots, oldest to newest
function take(queue: Lot[], n: number): { lots: Lot[]; missing: number } {
  const lots: Lot[] = [];
  let remaining = n;
  while (remaining > MARGIN && queue.length > 0) {
    const l = queue[0];
    if (l.units <= remaining + MARGIN) {
      lots.push(l);
      remaining -= l.units;
      queue.shift();
    } else {
      const unitsPart = remaining / l.units;
      lots.push({ ...l, units: remaining, cost: l.cost * unitsPart });
      l.units -= remaining;
      l.cost -= l.cost * unitsPart;
      remaining = 0;
    }
  }
  return { lots, missing: remaining > MARGIN ? remaining : 0 };
}

export function calculateTax(ops: TaxOp[], assets: TaxAsset[]): TaxReport {
  // Each asset, to its group of homogeneous securities
  const groupOf = new Map<string, string>();
  for (const a of assets) {
    const isin = a.isin?.trim().toUpperCase();
    groupOf.set(a.id, isin ? `isin:${isin}` : `id:${a.id}`);
  }
  const group = (assetId: string) => groupOf.get(assetId) ?? `id:${assetId}`;

  // Both sides of each fund switch
  const parts = new Map<string, { sale?: TaxOp; buy?: TaxOp }>();
  for (const o of ops) {
    if (!o.switch_id) continue;
    const p = parts.get(o.switch_id) ?? {};
    if (o.type === "sell") p.sale = o;
    if (o.type === "buy") p.buy = o;
    parts.set(o.switch_id, p);
  }
  const isSwitch = (o: TaxOp) => {
    const p = o.switch_id ? parts.get(o.switch_id) : undefined;
    return !!p?.sale && !!p?.buy;
  };

  // Order: by date; on the same day, buys, splits, sales and finally the incoming side of
  // switches. A switch's incoming side never goes before its outgoing side.
  const PRIORITY: Record<string, number> = { buy: 0, split: 1, sell: 2, dividend: 3 };
  const events = ops.map((o) => {
    if (o.type === "buy" && isSwitch(o)) {
      const outgoing = parts.get(o.switch_id!)!.sale!;
      return { o, date: o.date > outgoing.date ? o.date : outgoing.date, priority: 4 };
    }
    return { o, date: o.date, priority: PRIORITY[o.type] ?? 5 };
  });
  events.sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority);

  const queues = new Map<string, Lot[]>();
  const queue = (assetId: string) => {
    const g = group(assetId);
    if (!queues.has(g)) queues.set(g, []);
    return queues.get(g)!;
  };
  const inTransit = new Map<string, Lot[]>(); // lots that left in a switch and haven't arrived yet
  const result: TaxReport = { sales: [], switches: [], dividends: [] };
  const regularBuys = ops.filter((o) => o.type === "buy" && !isSwitch(o));

  for (const { o } of events) {
    const unitsPart = Number(o.units ?? 0);

    if (o.type === "buy" && isSwitch(o)) {
      const incoming = inTransit.get(o.switch_id!) ?? [];
      inTransit.delete(o.switch_id!);
      const total = incoming.reduce((s, l) => s + l.units, 0);
      const c = queue(o.asset_id);
      if (total > MARGIN) {
        // Same cost and same date; the units, those of the new fund
        const scale = unitsPart / total;
        for (const l of incoming) c.push({ ...l, asset_id: o.asset_id, units: l.units * scale });
      } else {
        c.push({
          buy: o.id,
          asset_id: o.asset_id,
          date: o.date,
          units: unitsPart,
          cost: Number(o.amount) + Number(o.fee),
        });
      }
      c.sort((a, b) => a.date.localeCompare(b.date)); // oldest first
      continue;
    }

    if (o.type === "buy") {
      queue(o.asset_id).push({
        buy: o.id,
        asset_id: o.asset_id,
        date: o.date,
        units: unitsPart,
        cost: Number(o.amount) + Number(o.fee),
      });
      continue;
    }

    if (o.type === "split") {
      // Only the units held in that asset; the cost doesn't change
      for (const l of queue(o.asset_id))
        if (l.asset_id === o.asset_id) l.units *= Number(o.factor ?? 1);
      continue;
    }

    if (o.type === "dividend") {
      result.dividends.push({
        asset_id: o.asset_id,
        date: o.date,
        gross: Number(o.amount),
        withholding: Number(o.withholding),
      });
      continue;
    }

    if (o.type !== "sell") continue;
    const c = queue(o.asset_id);
    const { lots, missing } = take(c, unitsPart);
    const cost = lots.reduce((s, l) => s + l.cost, 0);

    if (isSwitch(o)) {
      const target = parts.get(o.switch_id!)!.buy!;
      inTransit.set(o.switch_id!, lots);
      result.switches.push({
        id: o.id,
        source: o.asset_id,
        target: target.asset_id,
        date: o.date,
        value: round(Number(o.amount)),
        cost: round(cost),
        missing,
      });
      continue;
    }

    const proceeds = Number(o.amount) - Number(o.fee);
    const gain = round(proceeds - cost);
    // 2-month rule (Spain): if there's a loss and you bought the same security 2 months before (and
    // still hold those units) or 2 months after, the tax office doesn't allow using it yet.
    let twoMonths = false;
    if (gain < 0) {
      const from = addMonths(o.date, -2);
      const until = addMonths(o.date, 2);
      const stillThere = new Set(c.map((l) => l.buy));
      twoMonths = regularBuys.some(
        (x) =>
          group(x.asset_id) === group(o.asset_id) &&
          x.date >= from &&
          x.date <= until &&
          (x.date > o.date || stillThere.has(x.id)),
      );
    }
    result.sales.push({
      id: o.id,
      asset_id: o.asset_id,
      date: o.date,
      units: unitsPart,
      proceeds: round(proceeds),
      acquisition: round(cost),
      gain,
      lots: lots.map((l) => ({
        date: l.date,
        units: l.units,
        cost: l.cost,
      })),
      missing,
      twoMonths,
    });
  }

  return result;
}

export type TaxSummary = {
  gains: number; // sum of the sales with a gain
  losses: number; // sum of the sales with a loss (negative)
  net: number;
  blocked: number; // losses affected by the 2-month rule (negative)
  gross: number; // gross dividends
  withholding: number;
};

export function taxSummary(f: TaxReport, year: string): TaxSummary {
  const sales = f.sales.filter((v) => v.date.startsWith(year));
  const dividends = f.dividends.filter((d) => d.date.startsWith(year));
  const sum = (xs: number[]) => round(xs.reduce((s, x) => s + x, 0));
  const gains = sum(sales.filter((v) => v.gain > 0).map((v) => v.gain));
  const losses = sum(sales.filter((v) => v.gain < 0).map((v) => v.gain));
  return {
    gains,
    losses,
    net: round(gains + losses),
    blocked: sum(sales.filter((v) => v.twoMonths).map((v) => v.gain)),
    gross: sum(dividends.map((d) => d.gross)),
    withholding: sum(dividends.map((d) => d.withholding)),
  };
}

// Years with something to declare (sales, switches or dividends), newest to oldest
export function taxYears(f: TaxReport): string[] {
  const years = new Set<string>();
  for (const x of [...f.sales, ...f.switches, ...f.dividends]) years.add(x.date.slice(0, 4));
  return [...years].sort().reverse();
}
