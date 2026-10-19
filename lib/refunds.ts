// Refunds: income that pays back part of a specific expense (e.g. your friends' Bizum
// for the dinner you paid). Pure functions, no network or database.

export type Refund = {
  id: string;
  date: string;
  amount: number | string;
  description: string | null;
  refund_of_id: string | null;
};

export type RefundSummary = { count: number; total: number; list: Refund[] };

// For each expense: how many refunds it has and their total (oldest to newest)
export function refundsByExpense(refunds: Refund[]): Map<string, RefundSummary> {
  const lookup = new Map<string, RefundSummary>();
  for (const r of [...refunds].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!r.refund_of_id) continue;
    const current = lookup.get(r.refund_of_id) ?? { count: 0, total: 0, list: [] };
    current.count += 1;
    current.total = Math.round((current.total + Number(r.amount)) * 100) / 100;
    current.list.push(r);
    lookup.set(r.refund_of_id, current);
  }
  return lookup;
}

// The minimum for the spending analysis
type WithRefund = {
  id?: string;
  date: string;
  type: string;
  bizum: boolean;
  category_id: string | null;
  refund_of_id?: string | null;
};

// Each refund is subtracted from its own expense: it gets the date, category and Bizum
// of its expense. If the expense isn't in the list, it stays as it is.
export function attributeRefunds<T extends WithRefund>(movements: T[]): T[] {
  const expenses = new Map(
    movements.filter((m) => m.type === "expense" && m.id).map((m) => [m.id!, m]),
  );
  return movements.map((m) => {
    const g = m.type === "income" && m.refund_of_id ? expenses.get(m.refund_of_id) : undefined;
    return g ? { ...m, date: g.date, category_id: g.category_id, bizum: g.bizum } : m;
  });
}
