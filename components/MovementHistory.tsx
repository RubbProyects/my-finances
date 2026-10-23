"use client";

import { useCallback, useEffect, useState } from "react";
import Collapsible from "@/components/Collapsible";
import MovementForm, { movementTypeName, type EditableMovement } from "@/components/MovementForm";
import { field, gainColor, withSign, euros, prettyDate, today } from "@/lib/format";
import { language, t } from "@/lib/language";
import {
  CASH,
  monthsSince,
  monthName,
  monthRange,
  totals,
  type MovementType,
} from "@/lib/movements";
import { refundsByExpense, type Refund, type RefundSummary } from "@/lib/refunds";
import { supabase } from "@/lib/supabase";

type SelectOption = { id: string; name: string };

// The transaction as saved, plus the names of its account, target and category
type Movement = EditableMovement & {
  account: { name: string } | null;
  target: { name: string } | null;
  expense_categories: { name: string } | null;
};

type Filters = {
  type: "" | MovementType; // "" = all
  category: string; // "" = all, "sin" = no category, or the id
  account: string; // "" = all, CASH, or the id
  month: string; // "" = all, or "YYYY-MM"
  bizum: boolean; // true = Bizum only
};

const NO_FILTERS: Filters = { type: "", category: "", account: "", month: "", bizum: false };

// A function (not a fixed list) so the texts come out in the chosen language
const types = (): { id: "" | MovementType; text: string }[] => [
  { id: "", text: t("Todos", "All") },
  { id: "expense", text: t("Gastos", "Expenses") },
  { id: "income", text: t("Ingresos", "Income") },
  { id: "transfer", text: t("Transferencias", "Transfers") },
  { id: "adjustment", text: t("Ajustes", "Adjustments") },
];

// The filter dropdowns, narrower so two fit per row on mobile
const filterClass = `${field} w-full min-w-0 px-2`;

const PAGE_SIZE = 50;

const COLUMNS =
  "id, date, type, amount, bizum, description, account_id, target_account_id, category_id, refund_of_id, account:assets!account_id(name), target:assets!target_account_id(name), expense_categories(name)";

// The query with the filters applied (built again for each page)
function buildQuery(f: Filters) {
  let q = supabase.from("movements").select(COLUMNS);
  if (f.type) q = q.eq("type", f.type);
  if (f.category === "sin") q = q.is("category_id", null).in("type", ["expense", "income"]);
  else if (f.category) q = q.eq("category_id", f.category);
  if (f.account === CASH) q = q.is("account_id", null);
  else if (f.account) q = q.or(`account_id.eq.${f.account},target_account_id.eq.${f.account}`);
  if (f.month) {
    const { from, until } = monthRange(f.month);
    q = q.gte("date", from).lt("date", until);
  }
  if (f.bizum) q = q.eq("bizum", true);
  return q
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id");
}

type RefundedExpense = { id: string; date: string; description: string | null };

type Result = {
  key: string; // which filters were requested, to know if it's still loading
  movements: Movement[];
  refunds: Map<string, RefundSummary>; // expense id -> its refunds
  expenses: Map<string, RefundedExpense>; // expense id -> the expense (for refunds)
  firstDate: string | null; // the oldest transaction, for the list of months
  error: string;
};

// All refunds and the expenses they give something back to
async function fetchRefunds(): Promise<{
  refunds: Map<string, RefundSummary>;
  expenses: Map<string, RefundedExpense>;
}> {
  const list: Refund[] = [];
  for (let i = 0; ; i += 1000) {
    const { data } = await supabase
      .from("movements")
      .select("id, date, amount, description, refund_of_id")
      .not("refund_of_id", "is", null)
      .order("id")
      .range(i, i + 999);
    const batch = (data ?? []) as Refund[];
    list.push(...batch);
    if (batch.length < 1000) break;
  }
  const ids = [...new Set(list.map((r) => r.refund_of_id!))];
  const expenses = new Map<string, RefundedExpense>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase
      .from("movements")
      .select("id, date, description")
      .in("id", ids.slice(i, i + 100));
    for (const g of (data ?? []) as RefundedExpense[]) expenses.set(g.id, g);
  }
  return { refunds: refundsByExpense(list), expenses };
}

// Fetches all the transactions that match the filters.
// Supabase returns at most 1000 rows per request: we fetch page by page.
async function fetchMovementList(f: Filters, key: string): Promise<Result> {
  const [first, { refunds, expenses }] = await Promise.all([
    supabase.from("movements").select("date").order("date").limit(1),
    fetchRefunds(),
  ]);
  const movementList: Movement[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await buildQuery(f).range(i, i + 999);
    if (error)
      return {
        key,
        movements: movementList,
        refunds,
        expenses,
        firstDate: null,
        error: error.message,
      };
    const batch = (data ?? []) as unknown as Movement[];
    movementList.push(...batch);
    if (batch.length < 1000) break;
  }
  return {
    key,
    movements: movementList,
    refunds,
    expenses,
    firstDate: first.data?.[0]?.date ?? null,
    error: first.error?.message ?? "",
  };
}

// First letter in capitals: "octubre 2026" -> "Octubre 2026"
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function MovementHistory({
  accounts,
  categories,
  version,
}: {
  accounts: SelectOption[];
  categories: SelectOption[];
  version: number; // changes every time a new transaction is saved
}) {
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [reloadCount, setReloadCount] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [result, setResult] = useState<Result | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null); // id of the transaction being edited
  const [refundsOpenFor, setRefundsOpenFor] = useState<string | null>(null); // id of the open expense

  const key = `${JSON.stringify(filters)}|${version}|${reloadCount}`;

  const show = useCallback((r: Result) => {
    setResult(r);
    if (r.firstDate) setMonths(monthsSince(r.firstDate, today()));
  }, []);

  // Only fetches the data when the section is open
  useEffect(() => {
    if (!open) return;
    let active = true;
    fetchMovementList(filters, key).then((r) => {
      if (active) show(r);
    });
    return () => {
      active = false;
    };
  }, [open, filters, key, show]);

  function update(changes: Partial<Filters>) {
    const newOnes = { ...filters, ...changes };
    // Transfers and adjustments have no category or Bizum
    if (newOnes.type === "transfer" || newOnes.type === "adjustment") {
      newOnes.category = "";
      newOnes.bizum = false;
    }
    setFilters(newOnes);
    setVisibleCount(PAGE_SIZE);
    setNotice("");
  }

  async function remove(m: Movement) {
    const r = result?.refunds.get(m.id);
    const extra = r
      ? t(
          ` Tiene ${r.count === 1 ? "1 reembolso" : `${r.count} reembolsos`}: quedarán como ingresos normales.`,
          ` It has ${r.count === 1 ? "1 refund" : `${r.count} refunds`}: they'll stay as normal income.`,
        )
      : "";
    const name = movementTypeName(m.type).toLowerCase();
    const question = t(
      `¿Borrar este ${name} de ${euros(m.amount)}?${extra}`,
      `Delete this ${name} of ${euros(m.amount)}?${extra}`,
    );
    if (!confirm(question)) return;
    setNotice("");
    const { error } = await supabase.from("movements").delete().eq("id", m.id);
    if (error) {
      setNotice(error.message);
      return;
    }
    setReloadCount((r) => r + 1);
  }

  // When the changes are saved: closes the form and reloads the list
  function afterSave() {
    setEditing(null);
    setReloadCount((r) => r + 1);
  }

  const loading = open && result?.key !== key;
  const movementList = result?.movements ?? [];
  const tot = totals(movementList, filters.account === CASH ? "" : filters.account);
  const hasFilters = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const noCategory = filters.type === "transfer" || filters.type === "adjustment";
  const transfersOnly = filters.type === "transfer" && !filters.account;

  // Breakdown under the total: only the parts that exist
  const parts: string[] = [];
  if (tot.expenses) parts.push(`${t("Gastos", "Expenses")} −${euros(tot.expenses)}`);
  if (tot.income) parts.push(`${t("Ingresos", "Income")} +${euros(tot.income)}`);
  if (tot.adjustments) parts.push(`${t("Ajustes", "Adjustments")} ${withSign(tot.adjustments)}`);
  if (tot.transferred && !transfersOnly)
    parts.push(`${t("Transferencias", "Transfers")} ${euros(tot.transferred)}`);

  return (
    <Collapsible
      title={t("🕘 Historial de movimientos", "🕘 Transaction history")}
      summary={result && <span className="text-sm opacity-60">{movementList.length}</span>}
      onOpen={setOpen}
    >
      {/* ---------- Filters ---------- */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-sm opacity-70">{t("Tipo", "Type")}</span>
          <select
            className={filterClass}
            value={filters.type}
            onChange={(e) => update({ type: e.target.value as Filters["type"] })}
          >
            {types().map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.text}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-sm opacity-70">{t("Mes", "Month")}</span>
          <select
            className={filterClass}
            value={filters.month}
            onChange={(e) => update({ month: e.target.value })}
          >
            <option value="">{t("Todos", "All")}</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {capitalize(monthName(m, language()))}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-sm opacity-70">{t("Categoría", "Category")}</span>
          <select
            className={`${filterClass} disabled:opacity-50`}
            value={filters.category}
            disabled={noCategory}
            onChange={(e) => update({ category: e.target.value })}
          >
            <option value="">{t("Todas", "All")}</option>
            <option value="sin">{t("Sin categoría", "No category")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-sm opacity-70">{t("Cuenta", "Account")}</span>
          <select
            className={filterClass}
            value={filters.account}
            onChange={(e) => update({ account: e.target.value })}
          >
            <option value="">{t("Todas", "All")}</option>
            <option value={CASH}>{t("💵 Efectivo", "💵 Cash")}</option>
            {accounts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className={`flex items-center gap-3 py-1 ${noCategory ? "opacity-50" : ""}`}>
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={filters.bizum}
            disabled={noCategory}
            onChange={(e) => update({ bizum: e.target.checked })}
          />
          {t("Solo Bizum", "Bizum only")}
        </label>
        {hasFilters && (
          <button onClick={() => update(NO_FILTERS)} className="text-sm text-accent underline">
            {t("Quitar filtros", "Clear filters")}
          </button>
        )}
      </div>

      {result?.error && <p className="text-down">{result.error}</p>}
      {notice && <p className="text-down">{notice}</p>}

      {/* ---------- Total of what is filtered ---------- */}
      {result && movementList.length > 0 && (
        <div className={`rounded-xl bg-surface-2 p-3 ${loading ? "opacity-50" : ""}`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm opacity-70">
              {movementList.length}{" "}
              {movementList.length === 1
                ? t("movimiento", "transaction")
                : t("movimientos", "transactions")}
              {filters.month ? ` · ${monthName(filters.month, language())}` : ""}
            </span>
            {transfersOnly ? (
              <span className="font-bold">{euros(tot.transferred)}</span>
            ) : (
              <span className={`font-bold ${gainColor(tot.net)}`}>{withSign(tot.net)}</span>
            )}
          </div>
          {parts.length > 1 && <p className="mt-1 text-sm opacity-70">{parts.join(" · ")}</p>}
        </div>
      )}

      {/* ---------- List ---------- */}
      {!result ? (
        <p className="opacity-70">{t("Cargando...", "Loading...")}</p>
      ) : movementList.length === 0 ? (
        <p className={`opacity-70 ${loading ? "opacity-40" : ""}`}>
          {hasFilters
            ? t("No hay movimientos con estos filtros.", "No transactions match these filters.")
            : t("Todavía no hay movimientos.", "No transactions yet.")}
        </p>
      ) : (
        <ul className={`flex flex-col gap-2 ${loading ? "opacity-50" : ""}`}>
          {movementList.slice(0, visibleCount).map((m) => {
            const negative = m.type === "expense" || (m.type === "adjustment" && m.amount < 0);
            const sign = negative ? "−" : "+";
            const color = m.type === "transfer" ? "" : negative ? "text-down" : "text-up";
            const location =
              m.type === "transfer"
                ? `${m.account?.name ?? "?"} → ${m.target?.name ?? "?"}`
                : (m.account?.name ?? t("Efectivo", "Cash"));
            const refunds = m.type === "expense" ? result.refunds.get(m.id) : undefined;
            const ofExpense = m.refund_of_id ? result.expenses.get(m.refund_of_id) : undefined;
            const title =
              m.description ||
              m.expense_categories?.name ||
              (m.type === "adjustment"
                ? t("Ajuste de saldo", "Balance adjustment")
                : movementTypeName(m.type));

            if (editing === m.id) {
              return (
                <li key={m.id} className="rounded-xl border border-accent p-3">
                  <p className="mb-3 font-semibold">
                    {t("✏️ Editar movimiento", "✏️ Edit transaction")}
                  </p>
                  <MovementForm
                    accounts={accounts}
                    categories={categories}
                    movement={m}
                    onSave={afterSave}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              );
            }

            return (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">{title}</p>
                  <p className="text-sm opacity-70">
                    {prettyDate(m.date)} · {location}
                    {m.expense_categories && m.description ? ` · ${m.expense_categories.name}` : ""}
                    {m.bizum ? " · Bizum" : ""}
                  </p>
                  {ofExpense && (
                    <p className="text-sm text-up">
                      {t("↩️ Reembolso de", "↩️ Refund of")} «
                      {ofExpense.description ?? t("un gasto", "an expense")}» (
                      {prettyDate(ofExpense.date)})
                    </p>
                  )}
                  {refunds && (
                    <>
                      <button
                        onClick={() => setRefundsOpenFor(refundsOpenFor === m.id ? null : m.id)}
                        className="text-left text-sm text-up"
                      >
                        ↩️{" "}
                        {refunds.count === 1
                          ? t("1 reembolso", "1 refund")
                          : `${refunds.count} ${t("reembolsos", "refunds")}`}{" "}
                        <span>−{euros(refunds.total)}</span> · {t("te cuesta", "it costs you")}{" "}
                        <b>{euros(Math.round((Number(m.amount) - refunds.total) * 100) / 100)}</b>{" "}
                        <span className="underline">
                          {refundsOpenFor === m.id ? t("ocultar", "hide") : t("ver", "show")}
                        </span>
                      </button>
                      {refundsOpenFor === m.id && (
                        <ul className="mt-1 border-l-2 border-up/50 pl-2 text-sm opacity-80">
                          {refunds.list.map((r) => (
                            <li key={r.id}>
                              {prettyDate(r.date)} · {r.description ?? t("Reembolso", "Refund")} · +
                              {euros(Number(r.amount))}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <p className={`font-bold ${color}`}>
                    {m.type === "transfer"
                      ? euros(m.amount)
                      : `${sign}${euros(Math.abs(m.amount))}`}
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setEditing(m.id);
                        setNotice("");
                      }}
                      className="text-sm text-accent underline"
                    >
                      {t("Editar", "Edit")}
                    </button>
                    <button onClick={() => remove(m)} className="text-sm text-down underline">
                      {t("Borrar", "Delete")}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {movementList.length > visibleCount && (
        <button
          onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
          className="rounded-xl border border-line bg-surface p-3 text-base"
        >
          {t("Ver más", "Show more")} ({movementList.length - visibleCount} {t("más", "more")})
        </button>
      )}
    </Collapsible>
  );
}
