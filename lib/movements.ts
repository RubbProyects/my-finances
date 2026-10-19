// Pure functions for the transaction history (no UI or database)
import type { Language } from "@/lib/language";

export type MovementType = "expense" | "income" | "transfer" | "adjustment";

// The minimum of a transaction needed to compute totals
export type BaseMovement = {
  type: MovementType;
  amount: number;
  account_id: string | null;
  target_account_id: string | null;
};

// Special account-filter value for transactions with no account
export const CASH = "efectivo";

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const MONTH_NAMES_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// How much money goes up (+) or down (−) with this transaction.
// A transfer only counts when looking at a specific account: it leaves one and enters another.
export function effect(m: BaseMovement, accountFilter: string): number {
  const amount = Number(m.amount);
  switch (m.type) {
    case "expense":
      return -amount;
    case "income":
    case "adjustment":
      return amount;
    case "transfer":
      if (accountFilter && m.account_id === accountFilter) return -amount;
      if (accountFilter && m.target_account_id === accountFilter) return amount;
      return 0;
  }
}

export type Totals = {
  expenses: number; // positive
  income: number;
  adjustments: number; // with its sign
  transferred: number; // sum of the transfers, positive
  net: number; // how much money went up or down in total
};

export function totals(movements: BaseMovement[], accountFilter: string): Totals {
  const t: Totals = { expenses: 0, income: 0, adjustments: 0, transferred: 0, net: 0 };
  for (const m of movements) {
    const amount = Number(m.amount);
    if (m.type === "expense") t.expenses += amount;
    else if (m.type === "income") t.income += amount;
    else if (m.type === "adjustment") t.adjustments += amount;
    else t.transferred += amount;
    t.net += effect(m, accountFilter);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    expenses: round(t.expenses),
    income: round(t.income),
    adjustments: round(t.adjustments),
    transferred: round(t.transferred),
    net: round(t.net),
  };
}

// "2026-10" -> { desde: "2026-10-01", hasta: "2026-11-01" } ("hasta" not included)
export function monthRange(month: string): { from: string; until: string } {
  const [a, m] = month.split("-").map(Number);
  const next = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, until: `${next}-01` };
}

// "2026-10" -> "octubre 2026" (in English, "October 2026")
export function monthName(month: string, language: Language = "es"): string {
  const [a, m] = month.split("-").map(Number);
  return `${(language === "en" ? MONTH_NAMES_EN : MONTH_NAMES)[m - 1]} ${a}`;
}

// List of "YYYY-MM" months from the oldest date to today's, most recent first
export function monthsSince(oldestDate: string, today: string): string[] {
  const end = today.slice(0, 7);
  let current = oldestDate.slice(0, 7);
  if (current > end) current = end;
  const months: string[] = [];
  while (current <= end) {
    months.push(current);
    current = monthRange(current).until.slice(0, 7);
  }
  return months.reverse();
}
