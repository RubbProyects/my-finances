"use client";

import { useCallback, useEffect, useState } from "react";
import { field, euros, prettyDate } from "@/lib/format";
import { t } from "@/lib/language";
import { supabase } from "@/lib/supabase";

// An expense that can be picked, with what has already been refunded
export type PickableExpense = {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  category_id: string | null;
  refunded: number;
};

// Expenses from the 4 months before the refund and the 2 after are offered
// (sometimes the Bizum arrives before the bank books the expense, if it was on hold)
const DAYS_BEFORE = 120;
const DAYS_AFTER = 61;

function subtractDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Expenses from 4 months before to 2 months after (and the one already chosen, even if it's outside),
// with what other refunds have already given back (not counting "excludeId", the one being edited)
async function fetchExpenses(
  date: string,
  chosen: string,
  excludeId: string,
): Promise<PickableExpense[]> {
  const from = subtractDays(date, DAYS_BEFORE);
  const until = subtractDays(date, -DAYS_AFTER);
  const [expensesRes, chosenRes, refundsRes] = await Promise.all([
    supabase
      .from("movements")
      .select("id, date, amount, description, category_id")
      .eq("type", "expense")
      .gte("date", from)
      .lte("date", until)
      .order("date", { ascending: false })
      .order("id")
      .limit(500),
    chosen
      ? supabase
          .from("movements")
          .select("id, date, amount, description, category_id")
          .eq("id", chosen)
      : Promise.resolve({ data: [] }),
    supabase
      .from("movements")
      .select("id, amount, refund_of_id")
      .not("refund_of_id", "is", null)
      .gte("date", from)
      .order("id")
      .limit(1000),
  ]);
  type Row = Omit<PickableExpense, "refunded">;
  const expenses = (expensesRes.data ?? []) as Row[];
  for (const g of (chosenRes.data ?? []) as Row[]) {
    if (!expenses.some((x) => x.id === g.id)) expenses.push(g);
  }
  const refunded = new Map<string, number>();
  for (const r of (refundsRes.data ?? []) as {
    id: string;
    amount: number;
    refund_of_id: string;
  }[]) {
    if (r.id === excludeId) continue;
    refunded.set(r.refund_of_id, (refunded.get(r.refund_of_id) ?? 0) + Number(r.amount));
  }
  return expenses.map((g) => ({
    ...g,
    amount: Number(g.amount),
    refunded: Math.round((refunded.get(g.id) ?? 0) * 100) / 100,
  }));
}

// Dropdown to pick which expense a refund belongs to
export default function ExpensePicker({
  date,
  value,
  excludeId = "",
  onPick,
}: {
  date: string; // the date of the refund
  value: string; // id of the chosen expense ("" = none)
  excludeId?: string; // when editing a refund: its id, so it isn't counted twice
  onPick: (expense: PickableExpense | null) => void;
}) {
  const [expenses, setExpenses] = useState<PickableExpense[] | null>(null);

  const show = useCallback((g: PickableExpense[]) => setExpenses(g), []);

  useEffect(() => {
    if (date) fetchExpenses(date, value, excludeId).then(show);
  }, [date, value, excludeId, show]);

  if (!expenses)
    return <p className="text-sm opacity-70">{t("Cargando gastos...", "Loading expenses...")}</p>;
  if (expenses.length === 0)
    return (
      <p className="text-sm opacity-70">
        {t(
          "No hay gastos entre 4 meses antes y 2 meses después.",
          "No expenses from 4 months before to 2 months after.",
        )}
      </p>
    );

  return (
    <select
      className={field}
      value={value}
      onChange={(e) => onPick(expenses.find((g) => g.id === e.target.value) ?? null)}
    >
      <option value="">{t("Elige el gasto", "Choose the expense")}</option>
      {expenses.map((g) => (
        <option key={g.id} value={g.id}>
          {prettyDate(g.date).slice(0, 5)} · {g.description ?? t("Gasto", "Expense")} ·{" "}
          {euros(g.amount)}
          {g.date > date ? ` (${t("posterior", "later")})` : ""}
          {g.refunded > 0 ? ` (${t("ya devuelto", "already refunded")} ${euros(g.refunded)})` : ""}
        </option>
      ))}
    </select>
  );
}
