// Pure functions for the spending analysis (no UI or database)

// The minimum of a transaction needed to analyze spending
export type SpendingMovement = {
  id?: string;
  date: string; // YYYY-MM-DD
  type: "expense" | "income";
  amount: number;
  bizum: boolean;
  category_id: string | null;
  refund_of_id?: string | null; // if it's a refund: the expense it pays back
};

export type CategoryRow = {
  id: string | null; // null = no category
  spent: number; // every expense in that category
  refunded: number; // what was paid back to you in that category
  balance: number; // refunded − spent: negative if you spend more than you get back
  real: number; // spent − refunds linked to those expenses
};

export type SpendingSummary = {
  expenses: number; // everything spent
  refunded: number; // income with a category (refunds, Bizum payments to you...)
  balance: number; // refunded − expenses (negative = you spend more than you get back)
  realTotal: number; // expenses − refunds linked to an expense
};

const round = (n: number) => Math.round(n * 100) / 100;

// How much this transaction adds to net spending.
// Income only subtracts if it has a category (e.g. a cinema ticket refunded to you)
// or if it's the refund of an expense. Income with no category (salary) doesn't count.
export function netSpending(m: SpendingMovement): number {
  if (m.type === "expense") return Number(m.amount);
  if (m.category_id || m.refund_of_id) return -Number(m.amount);
  return 0;
}

// How much this transaction adds to real spending: expenses, minus refunds of a specific
// expense (what it really costs you). Standalone income, even with a category, doesn't count.
export function realSpending(m: SpendingMovement): number {
  if (m.type === "expense") return Number(m.amount);
  if (m.refund_of_id) return -Number(m.amount);
  return 0;
}

// Is this transaction within month "YYYY-MM"? With month "" everything counts.
export function inMonth(m: SpendingMovement, month: string): boolean {
  return !month || m.date.startsWith(month);
}

// Category key of a transaction for the filters (no category = "sin")
export const NO_CATEGORY = "sin";
export function categoryKey(id: string | null): string {
  return id ?? NO_CATEGORY;
}

// Keeps only the transactions of the chosen months ("YYYY-MM") and categories.
// An empty list doesn't filter: every month, or every category.
export function filterMovements(
  movements: SpendingMovement[],
  months: string[],
  categories: string[],
): SpendingMovement[] {
  return movements.filter(
    (m) =>
      (months.length === 0 || months.includes(m.date.slice(0, 7))) &&
      (categories.length === 0 || categories.includes(categoryKey(m.category_id))),
  );
}

// If the item is in the list it removes it, otherwise it adds it (the list stays sorted)
export function toggle(list: string[], x: string): string[] {
  return list.includes(x) ? list.filter((y) => y !== x) : [...list, x].sort();
}

export function summary(movements: SpendingMovement[], month: string): SpendingSummary {
  let expenses = 0;
  let refunded = 0;
  let real = 0;
  for (const m of movements) {
    if (!inMonth(m, month)) continue;
    const n = netSpending(m);
    if (n > 0) expenses += n;
    else refunded -= n;
    real += realSpending(m);
  }
  return {
    expenses: round(expenses),
    refunded: round(refunded),
    balance: round(refunded - expenses),
    realTotal: round(real),
  };
}

// What was spent, refunded, the balance and the real spending of each category in the month.
// Sorted from worst to best balance (the ones that cost you most, first).
export function byCategory(movements: SpendingMovement[], month: string): CategoryRow[] {
  const rows = new Map<string | null, CategoryRow>();
  for (const m of movements) {
    if (!inMonth(m, month)) continue;
    const n = netSpending(m);
    if (n === 0) continue;
    const f = rows.get(m.category_id) ?? {
      id: m.category_id,
      spent: 0,
      refunded: 0,
      balance: 0,
      real: 0,
    };
    if (n > 0) f.spent += n;
    else f.refunded -= n;
    f.real += realSpending(m);
    rows.set(m.category_id, f);
  }
  return [...rows.values()]
    .map((f) => ({
      id: f.id,
      spent: round(f.spent),
      refunded: round(f.refunded),
      balance: round(f.refunded - f.spent),
      real: round(f.real),
    }))
    .sort((a, b) => a.balance - b.balance);
}

// Real spending of each requested month, in the same order
export function byMonth(
  movements: SpendingMovement[],
  months: string[],
): { month: string; real: number }[] {
  const sums = new Map<string, number>(months.map((m) => [m, 0]));
  for (const m of movements) {
    const month = m.date.slice(0, 7);
    if (sums.has(month)) sums.set(month, sums.get(month)! + realSpending(m));
  }
  return months.map((month) => ({ month, real: round(sums.get(month)!) }));
}

// Real spending by Bizum vs the rest, in the month
export function bizumVsRest(
  movements: SpendingMovement[],
  month: string,
): { bizum: number; rest: number } {
  let bizum = 0;
  let rest = 0;
  for (const m of movements) {
    if (!inMonth(m, month)) continue;
    if (m.bizum) bizum += realSpending(m);
    else rest += realSpending(m);
  }
  return { bizum: round(bizum), rest: round(rest) };
}

// The "count" months ending in "until" (YYYY-MM), oldest to newest
export function monthsUntil(until: string, count: number): string[] {
  let [a, m] = until.split("-").map(Number);
  const months: string[] = [];
  for (let i = 0; i < count; i++) {
    months.unshift(`${a}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      a -= 1;
    }
  }
  return months;
}
