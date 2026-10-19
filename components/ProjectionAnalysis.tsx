"use client";

import { useCallback, useEffect, useState } from "react";
import Collapsible from "@/components/Collapsible";
import EvolutionChart from "@/components/EvolutionChart";
import { fetchPortfolio } from "@/lib/portfolio";
import {
  parseNumber,
  button,
  field,
  roundCents,
  gainColor,
  withSign,
  euros,
  today,
  numberToText,
  pctWithSign,
} from "@/lib/format";
import { language, t } from "@/lib/language";
import { monthName } from "@/lib/movements";
import {
  contributedAfter,
  relativeGain,
  gainAfter,
  projectionSeries,
  addMonths,
  valueAfter,
  type ProjectionInput,
} from "@/lib/projection";
import { supabase } from "@/lib/supabase";
import { typeName } from "@/lib/asset-types";

type Asset = {
  id: string;
  name: string;
  monthly_contribution: number;
  annual_return: number | null; // null = uses its type's one
  asset_types: {
    name: string;
    base_key: string | null;
    valuation: string;
    annual_return: number;
  } | null;
};

type Row = {
  a: Asset;
  today: number; // what it's worth now
  putIn: number; // what was contributed until today
  received: number; // sales and dividends already received
  typePct: number; // annual % of its type
};

// switched: what went out and came in through fund switches. For the total it's subtracted from what was
// put in and from what was received, because that money had already been contributed in the source fund.
type SwitchOp = { asset_id: string; type: string; amount: number };
type ViewData = { rows: Row[]; switched: { buys: number; sales: number }; error: string };

// Fetches the assets with their contribution and their %, what each one is worth today and what was contributed
async function fetchViewData(): Promise<ViewData> {
  const [assetsRes, balancesRes, switchesRes, portfolio] = await Promise.all([
    supabase
      .from("assets")
      .select(
        "id, name, monthly_contribution, annual_return, asset_types(name, base_key, valuation, annual_return)",
      )
      .order("created_at"),
    supabase.from("account_balances").select("account_id, balance"),
    supabase
      .from("transactions")
      .select("asset_id, type, amount")
      .not("switch_id", "is", null)
      .order("id"),
    fetchPortfolio(),
  ]);
  const balances = new Map(
    ((balancesRes.data ?? []) as { account_id: string; balance: number }[]).map((s) => [
      s.account_id,
      Number(s.balance),
    ]),
  );
  // Only assets with a price: one without a price counts €0 today and €0 put in
  const withPrice = new Map(portfolio.rows.filter((f) => f.value !== null).map((f) => [f.a.id, f]));

  const rows = ((assetsRes.data ?? []) as unknown as Asset[]).map((a) => {
    const balance = balances.get(a.id) ?? 0;
    const c = withPrice.get(a.id);
    const isBalance = a.asset_types?.valuation === "balance";
    return {
      a: {
        ...a,
        monthly_contribution: Number(a.monthly_contribution),
        annual_return: a.annual_return === null ? null : Number(a.annual_return),
      },
      today: isBalance ? balance : (c?.value ?? 0),
      // In an account (also the interest-bearing one) its whole balance today counts as contributed
      putIn: isBalance ? balance : (c?.pos.bought ?? 0),
      received: isBalance || !c ? 0 : c.pos.sold + c.pos.dividends,
      typePct: Number(a.asset_types?.annual_return ?? 0),
    };
  });

  const switched = { buys: 0, sales: 0 };
  for (const t of (switchesRes.data ?? []) as SwitchOp[]) {
    if (!withPrice.has(t.asset_id)) continue;
    if (t.type === "buy") switched.buys += Number(t.amount);
    else switched.sales += Number(t.amount);
  }

  const failure = assetsRes.error || balancesRes.error || switchesRes.error;
  return { rows, switched, error: failure ? failure.message : portfolio.error };
}

// 150.5 -> "150,5" (in English, "150.5"); 0 -> "" (an empty field is read as 0)
function amountText(n: number): string {
  return n ? numberToText(n) : "";
}

// -2.5 -> "-2,5" (in English, "-2.5"); null -> "" (empty = the type's %)
export function pctText(n: number | null): string {
  return n === null ? "" : numberToText(n);
}

// Reads a number, also accepting the minus sign "−" that some keyboards use
export function parseInput(text: string): number | null {
  return parseNumber(text.replace(/−/g, "-"));
}

// Toggles the sign of what was typed: "7" <-> "-7" (the iPhone keyboard has no "−" key)
export function toggleSign(text: string): string {
  const clean = text.trim().replace(/−/g, "-");
  if (clean === "") return "-";
  return clean.startsWith("-") ? clean.slice(1) : `-${clean}`;
}

export default function ProjectionAnalysis() {
  const [open, setOpen] = useState(false);
  const [viewData, setViewData] = useState<ViewData | null>(null);
  const [years, setYears] = useState("10");
  const [contributions, setContributions] = useState<Record<string, string>>({});
  const [annualReturns, setAnnualReturns] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Fills in the fields with what was saved
  const fill = useCallback((d: ViewData) => {
    setContributions(
      Object.fromEntries(d.rows.map((f) => [f.a.id, amountText(f.a.monthly_contribution)])),
    );
    setAnnualReturns(Object.fromEntries(d.rows.map((f) => [f.a.id, pctText(f.a.annual_return)])));
  }, []);

  const show = useCallback(
    (d: ViewData) => {
      setViewData(d);
      fill(d);
    },
    [fill],
  );

  // Only fetches the data the first time it's opened
  useEffect(() => {
    if (open && !viewData) fetchViewData().then(show);
  }, [open, viewData, show]);

  if (!viewData) {
    return (
      <Collapsible title={t("🔮 Proyección", "🔮 Projection")} onOpen={setOpen}>
        <p className="opacity-70">{t("Cargando...", "Loading...")}</p>
      </Collapsible>
    );
  }

  // Each asset's contribution as typed (empty = 0; if it isn't valid, null)
  const contributionOf = (id: string): number | null => {
    const text = contributions[id] ?? "";
    if (text.trim() === "") return 0;
    const n = parseInput(text);
    return n === null || n < 0 ? null : roundCents(n);
  };

  // The asset's own % as typed: "vacio" = uses the type's one; null = not valid.
  // Below −100 % makes no sense (at −100 % everything is already lost).
  const ownPctOf = (id: string): number | "empty" | null => {
    const text = annualReturns[id] ?? "";
    if (text.trim() === "") return "empty";
    const n = parseInput(text);
    return n === null || n <= -100 || n > 1000 ? null : n;
  };

  // The % used in the calculation
  const pctOf = (f: Row): number => {
    const own = ownPctOf(f.a.id);
    return own === "empty" || own === null ? f.typePct : own;
  };

  const nYears = parseNumber(years);
  const validYears = nYears !== null && Number.isInteger(nYears) && nYears >= 1 && nYears <= 50;
  const n = validYears ? nYears : 10;
  const months = n * 12;

  const inputs = viewData.rows.map((f): ProjectionInput => ({
    initial: f.today,
    contribution: contributionOf(f.a.id) ?? 0,
    annualPct: pctOf(f),
    putIn: f.putIn,
    received: f.received,
  }));
  // In the total, a fund switch isn't new money: it's removed from what was put in and from what was received
  const { switched } = viewData;
  const series = projectionSeries(inputs, n).map((p) => ({
    ...p,
    contributed: p.contributed - switched.buys,
    received: p.received - switched.sales,
  }));
  const last = series[series.length - 1];
  const gain = last.value + last.received - last.contributed;
  const relative = relativeGain(gain, last.contributed);
  const totalToday = series[0].value;
  const putInToday = series[0].contributed;
  const perMonth = inputs.reduce((s, e) => s + e.contribution, 0);
  const todayDate = today();
  const endDate = addMonths(todayDate, months);

  // Average % of the portfolio today, weighted by what each asset is worth
  const averagePct =
    totalToday > 0 ? inputs.reduce((s, e) => s + e.initial * e.annualPct, 0) / totalToday : null;

  // Which rows have unsaved changes
  const isChanged = (f: Row) => {
    const own = ownPctOf(f.a.id);
    const pctToSave = own === "empty" ? null : own;
    return contributionOf(f.a.id) !== f.a.monthly_contribution || pctToSave !== f.a.annual_return;
  };
  const changedRows = viewData.rows.filter(isChanged);
  const hasInvalid = viewData.rows.some(
    (f) => contributionOf(f.a.id) === null || ownPctOf(f.a.id) === null,
  );

  async function save() {
    setError("");
    setNotice("");
    if (hasInvalid) {
      setError(
        t(
          "Hay alguna casilla en rojo: corrígela antes de guardar",
          "A box is in red: fix it before saving",
        ),
      );
      return;
    }
    setSaving(true);
    const results = await Promise.all(
      changedRows.map((f) => {
        const own = ownPctOf(f.a.id);
        return supabase
          .from("assets")
          .update({
            monthly_contribution: contributionOf(f.a.id),
            annual_return: own === "empty" ? null : own,
          })
          .eq("id", f.a.id);
      }),
    );
    setSaving(false);
    const failure = results.find((r) => r.error)?.error;
    if (failure) {
      setError(failure.message);
      return;
    }
    setNotice(t("Cambios guardados", "Changes saved"));
    fetchViewData().then(show);
  }

  function undo() {
    if (!viewData) return;
    fill(viewData);
    setError("");
    setNotice("");
  }

  const edit = (which: "contribution" | "pct", id: string, value: string) => {
    setNotice("");
    if (which === "contribution") setContributions({ ...contributions, [id]: value });
    else setAnnualReturns({ ...annualReturns, [id]: value });
  };

  return (
    <Collapsible
      title={t("🔮 Proyección", "🔮 Projection")}
      summary={<span className="font-bold">{euros(last.value)}</span>}
      onOpen={setOpen}
    >
      {viewData.error && <p className="text-red-500">{viewData.error}</p>}

      <label className="flex flex-col gap-1">
        <span className="text-sm opacity-70">{t("Años", "Years")}</span>
        <input
          className={field}
          inputMode="numeric"
          value={years}
          onChange={(e) => setYears(e.target.value)}
        />
      </label>
      {!validYears && (
        <p className="text-sm text-red-500">
          {t(
            "Escribe un número entero de 1 a 50. Mientras, uso 10.",
            "Enter a whole number from 1 to 50. Meanwhile, I use 10.",
          )}
        </p>
      )}

      {/* ---------- Result ---------- */}
      <div className="rounded bg-gray-500/10 p-3">
        <p className="text-sm opacity-70">
          {t("En", "In")} {n} {n === 1 ? t("año", "year") : t("años", "years")} (
          {monthName(endDate.slice(0, 7), language())})
        </p>
        <p className="text-2xl font-bold">{euros(last.value)}</p>
        <p className="text-sm opacity-70">
          {t("Habrás puesto", "You'll have put in")} <span>{euros(last.contributed)}</span>:{" "}
          <span>{euros(putInToday)}</span> {t("hasta hoy", "so far")} +{" "}
          <span>{euros(perMonth)}</span> {t("al mes", "a month")}
        </p>
        <p className="text-sm">
          {gain < 0
            ? t("Pérdida estimada", "Estimated loss")
            : t("Ganancia estimada", "Estimated gain")}{" "}
          <span className={`font-semibold ${gainColor(gain)}`}>
            <span>{withSign(gain)}</span>
            {relative !== null && ` (${pctWithSign(relative)})`}
          </span>
        </p>
        {averagePct !== null && (
          <p className="text-sm opacity-70">
            {t("Rentabilidad media de lo que tienes hoy", "Average return of what you have today")}:{" "}
            {pctWithSign(averagePct)} {t("al año", "a year")}
          </p>
        )}
        {changedRows.length > 0 && (
          <p className="mt-1 text-sm text-amber-600">
            {t(
              "✏️ Hay cambios sin guardar: es una simulación",
              "✏️ Unsaved changes: this is a simulation",
            )}
          </p>
        )}
      </div>

      <EvolutionChart
        series={series.map((p) => ({
          date: addMonths(todayDate, p.month),
          value: p.value,
          contributed: p.contributed,
        }))}
      />

      {/* ---------- By asset ---------- */}
      <Collapsible
        title={t("Aportación y % por activo", "Contribution and % by asset")}
        nested
        open
      >
        {viewData.rows.length === 0 ? (
          <p className="text-sm opacity-70">
            {t(
              "Todavía no hay activos. Créalos en Ajustes.",
              "No assets yet. Create them in Settings.",
            )}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {viewData.rows.map((f, i) => {
              const contribution = contributionOf(f.a.id);
              const own = ownPctOf(f.a.id);
              const finalValue = valueAfter(inputs[i], months);
              const putIn = contributedAfter(inputs[i], months);
              const gains = gainAfter(inputs[i], months);
              return (
                <li
                  key={f.a.id}
                  className={`flex flex-col gap-2 rounded border p-3 ${
                    isChanged(f) ? "border-amber-500" : "border-gray-400/50"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold">{f.a.name}</span>
                    <span className="shrink-0 text-sm opacity-70">
                      {t("Hoy", "Today")} {euros(f.today)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-sm opacity-70">{t("€ al mes", "€ a month")}</span>
                      <input
                        className={`${field} w-full min-w-0 ${contribution === null ? "border-red-500" : ""}`}
                        inputMode="decimal"
                        placeholder="0"
                        value={contributions[f.a.id] ?? ""}
                        onChange={(e) => edit("contribution", f.a.id, e.target.value)}
                      />
                    </label>
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-sm opacity-70">{t("% al año", "% a year")}</span>
                      <div className="flex gap-1">
                        <input
                          className={`${field} w-full min-w-0 ${own === null ? "border-red-500" : ""}`}
                          inputMode="decimal"
                          placeholder={pctText(f.typePct)}
                          value={annualReturns[f.a.id] ?? ""}
                          onChange={(e) => edit("pct", f.a.id, e.target.value)}
                        />
                        <button
                          type="button"
                          aria-label={t("Cambiar el signo del %", "Change the sign of the %")}
                          onClick={() =>
                            edit("pct", f.a.id, toggleSign(annualReturns[f.a.id] ?? ""))
                          }
                          className="shrink-0 rounded border border-gray-400 px-3 text-base"
                        >
                          ±
                        </button>
                      </div>
                    </label>
                  </div>

                  {contribution === null ? (
                    <p className="text-sm text-red-500">
                      {t(
                        "La aportación debe ser 0 o más, por ejemplo 150",
                        "The contribution must be 0 or more, e.g. 150",
                      )}
                    </p>
                  ) : own === null ? (
                    <p className="text-sm text-red-500">
                      {t(
                        "El % debe ser un número mayor que −100, por ejemplo 7 o −2,5",
                        "The % must be a number over −100, e.g. 7 or −2.5",
                      )}
                    </p>
                  ) : (
                    <>
                      {own === "empty" && (
                        <p className="text-xs opacity-60">
                          {t("Usa el % de", "Uses the % of")}{" "}
                          {typeName(f.a.asset_types, language()) ?? t("su tipo", "its type")} (
                          {pctText(f.typePct)}
                          {t(" %", "%")})
                        </p>
                      )}
                      <p className="text-sm">
                        {t("En", "In")} {n} {n === 1 ? t("año", "year") : t("años", "years")}:{" "}
                        <span className="font-semibold">{euros(finalValue)}</span>
                        <span className="opacity-70">
                          {" "}
                          · {t("puesto", "put in")} {euros(putIn)} ·{" "}
                        </span>
                        <span className={gainColor(gains)}>{withSign(gains)}</span>
                      </p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {error && <p className="text-red-500">{error}</p>}
        {notice && <p className="text-green-600">{notice}</p>}
        {changedRows.length > 0 && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={undo}
              disabled={saving}
              className="flex-1 rounded border border-gray-400 p-3 text-base"
            >
              {t("Deshacer cambios", "Undo changes")}
            </button>
            <button type="button" onClick={save} disabled={saving} className={`${button} flex-1`}>
              {saving ? t("Guardando...", "Saving...") : t("Guardar", "Save")}
            </button>
          </div>
        )}
        <p className="text-xs opacity-60">
          {t(
            "Prueba aquí distintas aportaciones y rentabilidades: nada cambia hasta que pulses Guardar. Si dejas el % vacío, se usa el de su tipo (el tipo se cambia en Ajustes). Es una estimación: la rentabilidad real sube y baja cada año. Cada mes crece el equivalente al % anual y las aportaciones se hacen a principio de mes. La ganancia se mide sobre lo que has puesto: en las inversiones, lo comprado (como en Inversiones, contando ventas y dividendos); en las cuentas, su saldo de hoy.",
            "Try different contributions and returns here: nothing changes until you press Save. If you leave the % empty, its type's % is used (types are changed in Settings). It's an estimate: real returns go up and down every year. Each month grows the equivalent of the yearly % and contributions are made at the start of the month. The gain is measured on what you put in: for investments, what you bought (as in Investments, counting sales and dividends); for accounts, today's balance.",
          )}
        </p>
      </Collapsible>
    </Collapsible>
  );
}
