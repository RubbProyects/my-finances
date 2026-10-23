"use client";

import { useCallback, useEffect, useState } from "react";
import Collapsible from "@/components/Collapsible";
import {
  taxYears,
  calculateTax,
  taxSummary,
  type TaxAsset,
  type TaxReport,
  type TaxOp,
} from "@/lib/tax";
import {
  field,
  gainColor,
  withSign,
  euros,
  prettyDate,
  today,
  units as fmtPart,
} from "@/lib/format";
import { t } from "@/lib/language";
import { supabase } from "@/lib/supabase";

type ViewData = {
  taxReport: TaxReport;
  names: Map<string, string>;
  error: string;
};

// All activities and assets (with their ISIN), and the FIFO calculation
async function fetchViewData(): Promise<ViewData> {
  const ops: TaxOp[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, asset_id, date, type, amount, fee, withholding, units, factor, switch_id")
      .order("date")
      .order("id")
      .range(i, i + 999);
    if (error) return { taxReport: calculateTax([], []), names: new Map(), error: error.message };
    const batch = (data ?? []) as TaxOp[];
    ops.push(...batch);
    if (batch.length < 1000) break;
  }
  const { data, error } = await supabase
    .from("assets")
    .select("id, name, isin, asset_types(base_key)");
  const assets = (data ?? []) as unknown as (TaxAsset & {
    name: string;
    asset_types: { base_key: string | null } | null;
  })[];
  // Pension plans aren't taxed like selling a fund: they're left out
  const pensionPlans = new Set(
    assets.filter((a) => a.asset_types?.base_key === "pension_plan").map((a) => a.id),
  );
  return {
    taxReport: calculateTax(
      ops.filter((o) => !pensionPlans.has(o.asset_id)),
      assets.filter((a) => !pensionPlans.has(a.id)),
    ),
    names: new Map(assets.map((a) => [a.id, a.name])),
    error: error ? error.message : "",
  };
}

// "12/03/2024 (1,25)" for each buy sold; if there are many, the first 3 and how many more
function buysText(lots: { date: string; units: number }[]): string {
  const texts = lots.map((l) => `${prettyDate(l.date)} (${fmtPart(l.units)})`);
  return texts.length > 3
    ? `${texts.slice(0, 3).join(", ")} ${t("y", "and")} ${texts.length - 3} ${t("más", "more")}`
    : texts.join(", ");
}

export default function TaxAnalysis() {
  const [open, setOpen] = useState(false);
  const [viewData, setViewData] = useState<ViewData | null>(null);
  const [year, setYear] = useState(""); // "" = the most recent one with data

  const show = useCallback((d: ViewData) => setViewData(d), []);

  // Only fetches the data the first time it's opened
  useEffect(() => {
    if (open && !viewData) fetchViewData().then(show);
  }, [open, viewData, show]);

  if (!viewData) {
    return (
      <Collapsible title={t("🧾 Fiscal", "🧾 Tax")} onOpen={setOpen}>
        <p className="opacity-70">{t("Cargando...", "Loading...")}</p>
      </Collapsible>
    );
  }

  const { taxReport, names } = viewData;
  const years = taxYears(taxReport);
  const chosen = year || years[0] || today().slice(0, 4);
  const r = taxSummary(taxReport, chosen);
  const sales = taxReport.sales.filter((v) => v.date.startsWith(chosen)).reverse();
  const switches = taxReport.switches.filter((tr) => tr.date.startsWith(chosen)).reverse();
  const name = (id: string) => names.get(id) ?? t("¿Borrado?", "Deleted?");

  // Dividends for the year, added up by asset
  const byAsset = new Map<string, { gross: number; withholding: number }>();
  for (const d of taxReport.dividends.filter((x) => x.date.startsWith(chosen))) {
    const s = byAsset.get(d.asset_id) ?? { gross: 0, withholding: 0 };
    s.gross += d.gross;
    s.withholding += d.withholding;
    byAsset.set(d.asset_id, s);
  }

  return (
    <Collapsible
      title={t("🧾 Fiscal", "🧾 Tax")}
      summary={<span className="text-sm opacity-60">{chosen}</span>}
      onOpen={setOpen}
    >
      {viewData.error && <p className="text-down">{viewData.error}</p>}

      <label className="flex flex-col gap-1">
        <span className="text-sm opacity-70">{t("Año", "Year")}</span>
        <select className={field} value={chosen} onChange={(e) => setYear(e.target.value)}>
          {(years.includes(chosen) ? years : [chosen, ...years]).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>

      {/* ---------- SUMMARY OF THE YEAR ---------- */}
      <div className="rounded-xl border border-line bg-surface p-3">
        <p className="text-sm opacity-70">
          {t("Ganancias y pérdidas de tus ventas", "Gains and losses on your sales")}
        </p>
        <p className={`text-2xl font-bold ${gainColor(r.net)}`}>{withSign(r.net)}</p>
        <p className="text-sm opacity-70">
          {t("Ganancias", "Gains")} <span>{euros(r.gains)}</span> · {t("Pérdidas", "Losses")}{" "}
          <span>{euros(Math.abs(r.losses))}</span>
        </p>
        {r.blocked < 0 && (
          <p className="mt-1 text-sm text-orange-500">
            ⚠️ <span>{euros(Math.abs(r.blocked))}</span>{" "}
            {t(
              "de pérdidas pueden no contar este año (regla de los 2 meses).",
              "of losses may not count this year (Spain's 2-month rule).",
            )}
          </p>
        )}
        <p className="mt-2 text-sm opacity-70">{t("Dividendos", "Dividends")}</p>
        <p className="font-semibold">
          {t("Bruto", "Gross")} <span>{euros(r.gross)}</span> · {t("retenido", "withheld")}{" "}
          <span>{euros(r.withholding)}</span>
        </p>
      </div>

      {/* ---------- SALES ---------- */}
      <Collapsible
        title={t("Ventas", "Sales")}
        nested
        open
        summary={<span className="text-sm opacity-60">{sales.length}</span>}
      >
        {sales.length === 0 ? (
          <p className="text-sm opacity-70">
            {t("No vendiste nada en", "You sold nothing in")} {chosen}.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sales.map((v) => (
              <li key={v.id} className="rounded-xl border border-line p-2 text-sm">
                <div className="flex justify-between gap-3">
                  <p className="min-w-0 font-medium">
                    {prettyDate(v.date)} · {name(v.asset_id)}
                  </p>
                  <p className={`shrink-0 font-semibold ${gainColor(v.gain)}`}>
                    {withSign(v.gain)}
                  </p>
                </div>
                <p className="opacity-70">
                  {fmtPart(v.units)} {t("participaciones", "units")} ·{" "}
                  {t("recibiste", "you received")} <span>{euros(v.proceeds)}</span> ·{" "}
                  {t("costaron", "they cost")} <span>{euros(v.acquisition)}</span>
                </p>
                {v.lots.length > 0 && (
                  <p className="opacity-70">
                    {t("Compradas el", "Bought on")} {buysText(v.lots)}
                  </p>
                )}
                {v.missing > 0 && (
                  <p className="text-orange-500">
                    {t(
                      `⚠️ Faltan compras de ${fmtPart(v.missing)} participaciones: cuentan como coste 0. Apunta las compras antiguas en Inversiones.`,
                      `⚠️ Missing buys for ${fmtPart(v.missing)} units: they count as cost 0. Add your old buys in Investments.`,
                    )}
                  </p>
                )}
                {v.twoMonths && (
                  <p className="text-orange-500">
                    {t(
                      "⚠️ Regla de los 2 meses: compraste el mismo valor 2 meses antes o después. Esta pérdida no se puede usar hasta que vendas esas participaciones.",
                      "⚠️ 2-month rule (Spain): you bought the same security 2 months before or after. This loss can't be used until you sell those units.",
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Collapsible>

      {/* ---------- FUND SWITCHES ---------- */}
      {switches.length > 0 && (
        <Collapsible
          title={t("🔁 Traspasos (no tributan)", "🔁 Fund switches (tax-free)")}
          nested
          summary={<span className="text-sm opacity-60">{switches.length}</span>}
        >
          <ul className="flex flex-col gap-2">
            {switches.map((tr) => (
              <li key={tr.id} className="rounded-xl border border-line p-2 text-sm">
                <p className="font-medium">
                  {prettyDate(tr.date)} · {name(tr.source)} → {name(tr.target)}
                </p>
                <p className="opacity-70">
                  {t("Traspasaste", "You switched")} <span>{euros(tr.value)}</span> ·{" "}
                  {t("el fondo nuevo se queda con un coste de", "the new fund keeps a cost of")}{" "}
                  <span>{euros(tr.cost)}</span>
                </p>
                {tr.missing > 0 && (
                  <p className="text-orange-500">
                    {t(
                      `⚠️ Faltan compras de ${fmtPart(tr.missing)} participaciones en el fondo de origen.`,
                      `⚠️ Missing buys for ${fmtPart(tr.missing)} units in the source fund.`,
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs opacity-60">
            {t(
              "En un traspaso no pagas: el fondo nuevo hereda el coste y la fecha de tus compras, y pagarás cuando vendas sin traspasar.",
              "A fund switch is tax-free in Spain: the new fund inherits the cost and date of your buys, and you pay when you sell without switching.",
            )}
          </p>
        </Collapsible>
      )}

      {/* ---------- DIVIDENDS ---------- */}
      {byAsset.size > 0 && (
        <Collapsible
          title={t("Dividendos", "Dividends")}
          nested
          summary={<span className="text-sm opacity-60">{byAsset.size}</span>}
        >
          <ul className="flex flex-col gap-1 text-sm">
            {[...byAsset].map(([id, s]) => (
              <li key={id} className="flex justify-between gap-3">
                <span className="min-w-0">{name(id)}</span>
                <span className="shrink-0">
                  <span>{euros(s.gross)}</span> · {t("ret.", "w/h")}{" "}
                  <span>{euros(s.withholding)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}

      <p className="text-xs opacity-60">
        {t(
          "Es orientativo: compras más antiguas primero (FIFO), juntando el mismo ISIN aunque esté en plataformas distintas, con las comisiones incluidas. Compáralo con el informe fiscal de tu bróker antes de hacer la renta. Los planes de pensiones no salen aquí: tributan al rescatarlos, como rendimiento del trabajo.",
          "For guidance only, following Spanish tax rules: oldest buys first (FIFO), grouping the same ISIN across platforms, fees included. Check it against your broker's tax report before filing. Pension plans aren't shown here: in Spain they're taxed as earned income when withdrawn.",
        )}
      </p>
    </Collapsible>
  );
}
