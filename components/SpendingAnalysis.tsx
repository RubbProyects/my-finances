"use client";

import { useCallback, useEffect, useState } from "react";
import Collapsible from "@/components/Collapsible";
import { field, gainColor, withSign, euros, today, percent } from "@/lib/format";
import { language, t } from "@/lib/language";
import {
  toggle,
  bizumVsRest,
  categoryKey,
  filterMovements,
  monthsUntil,
  byCategory,
  byMonth,
  summary,
  type SpendingMovement,
} from "@/lib/spending";
import { monthsSince, monthName } from "@/lib/movements";
import { attributeRefunds } from "@/lib/refunds";
import { supabase } from "@/lib/supabase";

type ViewData = {
  movements: SpendingMovement[];
  categories: Map<string, string>; // id -> name
  error: string;
};

// The bars use the same blue as the returns chart
const BLUE = "bg-[#2a78d6] dark:bg-[#3987e5]";

const INITIALS = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const INITIALS_EN = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

// Fetches the categories and all expenses and income.
// Supabase returns at most 1000 rows per request: we fetch page by page.
async function fetchViewData(): Promise<ViewData> {
  const categoriesRes = await supabase.from("expense_categories").select("id, name");
  const categories = new Map(
    ((categoriesRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );
  const movementList: SpendingMovement[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabase
      .from("movements")
      .select("id, date, type, amount, bizum, category_id, refund_of_id")
      .in("type", ["expense", "income"])
      .order("date")
      .order("id")
      .range(i, i + 999);
    if (error) return { movements: movementList, categories, error: error.message };
    const batch = (data ?? []) as SpendingMovement[];
    movementList.push(...batch);
    if (batch.length < 1000) break;
  }
  // Each refund is subtracted from its expense: in that expense's month and category
  return {
    movements: attributeRefunds(movementList),
    categories,
    error: categoriesRes.error?.message ?? "",
  };
}

// "octubre 2026" -> "Octubre 2026"
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Joins a list: ["a", "b", "c"] -> "a, b y c" (in English, "a, b and c")
function joinList(texts: string[]): string {
  return texts.length < 2
    ? (texts[0] ?? "")
    : `${texts.slice(0, -1).join(", ")} ${t("y", "and")} ${texts[texts.length - 1]}`;
}

// The chosen months, as text: "Octubre 2026", "Julio 2026 y agosto 2026", "5 meses"...
function monthsText(months: string[]): string {
  if (months.length === 0) return t("Todo el tiempo", "All time");
  if (months.length > 3) return `${months.length} ${t("meses", "months")}`;
  return capitalize(joinList(months.map((m) => monthName(m, language()))));
}

// A row with a name, amount, % and a proportional bar below.
// With "colored", the amount has a sign: green if it's positive and red if it's negative.
// With "onTap" it can be tapped to choose it (and "chosen" highlights it).
function BarRow({
  name,
  amount,
  pct,
  detail,
  colored,
  onTap,
  chosen,
  dimmed,
}: {
  name: string;
  amount: number;
  pct: number;
  detail?: string;
  colored?: boolean;
  onTap?: () => void;
  chosen?: boolean;
  dimmed?: boolean;
}) {
  const content = (
    <>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">
          {chosen && <span className="mr-1 font-bold text-accent">✓</span>}
          {name}
        </span>
        <span className="shrink-0">
          <span className={`font-semibold ${colored ? gainColor(amount) : ""}`}>
            {colored ? withSign(amount) : euros(amount)}
          </span>
          {pct > 0 && <span className="ml-2 opacity-60">{percent(pct)}</span>}
        </span>
      </div>
      {detail && <p className="text-xs opacity-60">{detail}</p>}
      <div className="h-2 rounded-xl bg-surface-2">
        {pct > 0 && (
          <div className={`h-2 rounded ${BLUE}`} style={{ width: `${Math.max(pct, 1)}%` }} />
        )}
      </div>
    </>
  );
  return (
    <li className={`flex flex-col gap-1 ${dimmed ? "opacity-40" : ""}`}>
      {onTap ? (
        <button
          type="button"
          onClick={onTap}
          aria-pressed={chosen}
          className="flex flex-col gap-1 text-left"
        >
          {content}
        </button>
      ) : (
        content
      )}
    </li>
  );
}

export default function SpendingAnalysis() {
  const [open, setOpen] = useState(false);
  const [viewData, setViewData] = useState<ViewData | null>(null);
  // Filters: empty lists = no filter (all time, all categories)
  const [months, setMonths] = useState<string[]>(() => [today().slice(0, 7)]);
  const [cats, setCats] = useState<string[]>([]); // category keys ("sin" = no category)

  const show = useCallback((d: ViewData) => setViewData(d), []);

  // Only fetches the data the first time it's opened
  useEffect(() => {
    if (open && !viewData) fetchViewData().then(show);
  }, [open, viewData, show]);

  if (!viewData) {
    return (
      <Collapsible title={t("💸 Gastos", "💸 Spending")} onOpen={setOpen}>
        <p className="opacity-70">{t("Cargando...", "Loading...")}</p>
      </Collapsible>
    );
  }

  const movements = viewData.movements;
  const currentMonth = today().slice(0, 7);
  const allMonths = movements.length ? monthsSince(movements[0].date, today()) : [currentMonth];

  const categoryName = (key: string) =>
    key === "sin"
      ? t("Sin categoría", "No category")
      : (viewData.categories.get(key) ?? t("¿Borrada?", "Deleted?"));

  // What goes into each part of the analysis
  const ofPeriod = filterMovements(movements, months, []); // the list of categories shows all of them
  const ofCategories = filterMovements(movements, [], cats); // the monthly bars show all the months
  const chosenIds = filterMovements(movements, months, cats); // the total and Bizum

  const r = summary(chosenIds, "");
  const categories = byCategory(ofPeriod, "");
  const spentTotal = categories.reduce((s, c) => s + c.spent, 0);
  const realRows = categories.filter((c) => c.real !== 0).sort((a, b) => b.real - a.real);
  const realTotal = realRows.reduce((s, c) => s + Math.max(0, c.real), 0);
  const bizum = bizumVsRest(chosenIds, "");
  const bizumTotal = Math.max(0, bizum.bizum) + Math.max(0, bizum.rest);
  const pctOf = (n: number) => (bizumTotal > 0 && n > 0 ? (n / bizumTotal) * 100 : 0);

  // Evolution: the last 12 months (or the 12 ending in the last one chosen, if it's older)
  const last12 = monthsUntil(currentMonth, 12);
  const lastChosen = months[months.length - 1];
  const evolution = byMonth(
    ofCategories,
    lastChosen && lastChosen < last12[0] ? monthsUntil(lastChosen, 12) : last12,
  );
  const maximum = Math.max(...evolution.map((e) => e.real), 1);
  const previous =
    months.length === 1 ? byMonth(ofCategories, [monthsUntil(months[0], 2)[0]])[0] : null;
  // The average only counts full months since the first transaction (before that you weren't using the app)
  const withData = evolution.filter(
    (e) => e.month >= allMonths[allMonths.length - 1] && e.month < currentMonth,
  );
  const average = withData.reduce((s, e) => s + e.real, 0) / Math.max(withData.length, 1);

  // The month dropdown: one month, all time, or "varios" if several were chosen in the bars
  const selectorValue = months.length === 0 ? "" : months.length === 1 ? months[0] : "varios";
  const categoriesText = cats.length ? joinList(cats.map(categoryName)) : "";

  return (
    <Collapsible
      title={t("💸 Gastos", "💸 Spending")}
      summary={<span className="font-bold">{euros(r.realTotal)}</span>}
      onOpen={setOpen}
    >
      {viewData.error && <p className="text-down">{viewData.error}</p>}

      <label className="flex flex-col gap-1">
        <span className="text-sm opacity-70">{t("Mes", "Month")}</span>
        <select
          className={field}
          value={selectorValue}
          onChange={(e) => setMonths(e.target.value ? [e.target.value] : [])}
        >
          {months.length > 1 && (
            <option value="varios" disabled>
              {monthsText(months)}
            </option>
          )}
          {allMonths.map((m) => (
            <option key={m} value={m}>
              {capitalize(monthName(m, language()))}
            </option>
          ))}
          <option value="">{t("Todo el tiempo", "All time")}</option>
        </select>
      </label>

      {/* ---------- Total of what is chosen ---------- */}
      <div className="rounded-xl bg-surface-2 p-3">
        <p className="text-sm opacity-70">
          {t("Gastos reales", "Real spending")} · {monthsText(months)}
          {categoriesText && ` · ${categoriesText}`}
        </p>
        <p className="text-2xl font-bold">{euros(r.realTotal)}</p>
        {previous && (
          <p className="text-sm opacity-70">
            {capitalize(monthName(previous.month, language()))}: {euros(previous.real)}
          </p>
        )}
        <p className="mt-2 text-sm">
          {t("Balance", "Balance")}:{" "}
          <span className={`font-semibold ${gainColor(r.balance)}`}>{withSign(r.balance)}</span>
        </p>
        <p className="text-sm opacity-70">
          {t("Gastado", "Spent")} <span>{euros(r.expenses)}</span> ·{" "}
          {t("Te han devuelto", "Paid back to you")} <span>{euros(r.refunded)}</span>
        </p>
        {(months.length > 1 || cats.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {months.length > 1 && (
              <button
                type="button"
                onClick={() => setMonths([currentMonth])}
                className="text-accent underline"
              >
                {t("Volver al mes actual", "Back to this month")}
              </button>
            )}
            {cats.length > 0 && (
              <button type="button" onClick={() => setCats([])} className="text-accent underline">
                {t("Todas las categorías", "All categories")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ---------- Balance by category ---------- */}
      <Collapsible title={t("Balance por categoría", "Balance by category")} nested open>
        {categories.length === 0 ? (
          <p className="text-sm opacity-70">
            {t("No hay gastos en este periodo.", "No spending in this period.")}
          </p>
        ) : (
          <>
            <p className="text-xs opacity-60">
              {t(
                "Toca una o varias categorías para ver solo esas en el resto del análisis.",
                "Tap one or more categories to see only those in the rest of the analysis.",
              )}
            </p>
            <ul className="flex flex-col gap-3">
              {categories.map((c) => {
                const key = categoryKey(c.id);
                const chosen = cats.includes(key);
                return (
                  <BarRow
                    key={key}
                    name={categoryName(key)}
                    amount={c.balance}
                    colored
                    pct={spentTotal > 0 ? (c.spent / spentTotal) * 100 : 0}
                    detail={`${t("Gastado", "Spent")} ${euros(c.spent)} · ${t("Devuelto", "Paid back")} ${euros(c.refunded)}`}
                    chosen={chosen}
                    dimmed={cats.length > 0 && !chosen}
                    onTap={() => setCats(toggle(cats, key))}
                  />
                );
              })}
            </ul>
          </>
        )}
        <p className="text-xs opacity-60">
          {t(
            "Balance = lo que te devuelven − lo que gastas: en rojo si gastas más, en verde si te devuelven más. El % es la parte de todo lo gastado. Las transferencias, los ajustes y los ingresos sin categoría (como la nómina) no cuentan.",
            "Balance = what you get back − what you spend: red if you spend more, green if you get more back. The % is the share of all spending. Transfers, adjustments and income with no category (like your salary) don't count.",
          )}
        </p>
      </Collapsible>

      {/* ---------- Real spending by category ---------- */}
      <Collapsible title={t("Gastos reales por categoría", "Real spending by category")} nested>
        {realRows.length === 0 ? (
          <p className="text-sm opacity-70">
            {t("No hay gastos en este periodo.", "No spending in this period.")}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {realRows.map((c) => {
              const key = categoryKey(c.id);
              const chosen = cats.includes(key);
              return (
                <BarRow
                  key={key}
                  name={categoryName(key)}
                  amount={c.real}
                  colored={c.real < 0}
                  pct={realTotal > 0 && c.real > 0 ? (c.real / realTotal) * 100 : 0}
                  chosen={chosen}
                  dimmed={cats.length > 0 && !chosen}
                  onTap={() => setCats(toggle(cats, key))}
                />
              );
            })}
          </ul>
        )}
        <p className="text-xs opacity-60">
          {t(
            "Solo tus gastos. Lo que te devuelven no se resta, salvo los reembolsos enlazados a un gasto (↩️), que rebajan lo que te cuesta ese gasto.",
            "Only your spending. What you get back isn't subtracted, except refunds linked to an expense (↩️), which lower what that expense costs you.",
          )}
        </p>
      </Collapsible>

      {/* ---------- Monthly evolution ---------- */}
      <Collapsible title={t("Últimos 12 meses", "Last 12 months")} nested>
        <p className="text-xs opacity-60">
          {t(
            "Gastos reales de cada mes. Toca una o varias barras para sumar esos meses",
            "Real spending each month. Tap one or more bars to add up those months",
          )}
          {categoriesText ? `. ${t("Solo", "Only")} ${categoriesText}.` : "."}
        </p>
        <div className="flex h-32 items-end gap-0.5">
          {evolution.map((e) => {
            const chosen = months.length === 0 || months.includes(e.month); // no filter, all of them
            return (
              <button
                key={e.month}
                type="button"
                onClick={() => setMonths(toggle(months, e.month))}
                aria-pressed={months.includes(e.month)}
                aria-label={`${monthName(e.month, language())}: ${euros(e.real)}`}
                title={`${capitalize(monthName(e.month, language()))}: ${euros(e.real)}`}
                className="flex h-full flex-1 items-end"
              >
                <span
                  className={`w-full rounded-t ${BLUE} ${chosen ? "" : "opacity-40"}`}
                  style={{ height: `${Math.max(0, (e.real / maximum) * 100)}%` }}
                />
              </button>
            );
          })}
        </div>
        <div className="flex gap-0.5 text-center text-xs opacity-60">
          {evolution.map((e) => (
            <span key={e.month} className={`flex-1 ${months.includes(e.month) ? "font-bold" : ""}`}>
              {(language() === "en" ? INITIALS_EN : INITIALS)[Number(e.month.slice(5)) - 1]}
            </span>
          ))}
        </div>
        {withData.length > 0 && (
          <p className="text-sm">
            {t("Media mensual", "Monthly average")} ({withData.length}{" "}
            {withData.length === 1
              ? t("mes completo", "full month")
              : t("meses completos", "full months")}
            ): <span className="font-semibold">{euros(average)}</span>
          </p>
        )}
      </Collapsible>

      {/* ---------- Bizum vs the rest ---------- */}
      <Collapsible title={t("Bizum frente al resto", "Bizum vs the rest")} nested>
        {bizum.bizum === 0 && bizum.rest === 0 ? (
          <p className="text-sm opacity-70">
            {t("No hay gastos en este periodo.", "No spending in this period.")}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            <BarRow
              name={t("Por Bizum", "By Bizum")}
              amount={bizum.bizum}
              pct={pctOf(bizum.bizum)}
            />
            <BarRow name={t("Resto", "The rest")} amount={bizum.rest} pct={pctOf(bizum.rest)} />
          </ul>
        )}
      </Collapsible>
    </Collapsible>
  );
}
