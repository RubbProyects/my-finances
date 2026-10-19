"use client";

import { useCallback, useEffect, useState } from "react";
import { toggleSign, parseInput, pctText } from "@/components/ProjectionAnalysis";
import Collapsible from "@/components/Collapsible";
import EvolutionChart from "@/components/EvolutionChart";
import {
  parseNumber,
  field,
  roundCents,
  gainColor,
  withSign,
  euros,
  today,
  pctWithSign,
} from "@/lib/format";
import { language, t } from "@/lib/language";
import { monthName } from "@/lib/movements";
import { relativeGain, addMonths } from "@/lib/projection";
import {
  simulatedContributed,
  simulationSeries,
  simulatedValue,
  TIMES_PER_YEAR,
  type SimulationRow,
  type Frequency,
} from "@/lib/simulator";
import { supabase } from "@/lib/supabase";

type Asset = { id: string; name: string; pct: number }; // pct: its own or, if not, its type's

// What was typed in each row, as is (text), so it can be remembered on this device
type Row = {
  key: string;
  assetId: string;
  initial: string;
  contribution: string;
  frequency: Frequency;
  pct: string; // empty = the asset's %
};

type SavedState = { years: string; rows: Row[] };
type ViewData = { assets: Asset[]; saved: SavedState; error: string };

// localStorage key: the simulation is only remembered on this device
const STORAGE_KEY = "simulador";

// A function (not a fixed list) so the texts come out in the chosen language
const frequencies = (): { id: Frequency; text: string }[] => [
  { id: "weekly", text: t("semana", "week") },
  { id: "monthly", text: t("mes", "month") },
  { id: "yearly", text: t("año", "year") },
];

function newRow(assetId: string): Row {
  return {
    key: crypto.randomUUID(),
    assetId,
    initial: "",
    contribution: "",
    frequency: "monthly",
    pct: "",
  };
}

// Reads the simulation saved on this device (if there's none or it's broken, it starts empty)
function readSaved(): SavedState {
  try {
    const g = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    // Before October 2026 it was saved with Spanish names: { anos, filas: [{ activoId, inicial,
    // aportacion, frecuencia: "mensual"... }] }. Both are read.
    const saved = g?.rows ?? g?.filas;
    if (g && Array.isArray(saved)) {
      const OLD_FREQUENCY: Record<string, Frequency> = {
        semanal: "weekly",
        mensual: "monthly",
        anual: "yearly",
      };
      const rows = (saved as Record<string, unknown>[])
        .map((f) => ({
          assetId: f.assetId ?? f.activoId,
          initial: f.initial ?? f.inicial,
          contribution: f.contribution ?? f.aportacion,
          frequency: (OLD_FREQUENCY[String(f.frecuencia)] ?? f.frequency) as Frequency,
          pct: f.pct,
        }))
        .filter((f) => typeof f.assetId === "string" && f.frequency in TIMES_PER_YEAR)
        .map((f) => ({
          key: crypto.randomUUID(),
          assetId: f.assetId as string,
          initial: String(f.initial ?? ""),
          contribution: String(f.contribution ?? ""),
          frequency: f.frequency,
          pct: String(f.pct ?? ""),
        }));
      return { years: String(g.years ?? g.anos ?? "10"), rows };
    }
  } catch {}
  return { years: "10", rows: [] };
}

// Fetches the assets with their % and restores the saved simulation
async function fetchViewData(): Promise<ViewData> {
  const res = await supabase
    .from("assets")
    .select("id, name, annual_return, asset_types(annual_return)")
    .order("created_at");
  const assets = (
    (res.data ?? []) as unknown as {
      id: string;
      name: string;
      annual_return: number | null;
      asset_types: { annual_return: number } | null;
    }[]
  ).map((a) => ({
    id: a.id,
    name: a.name,
    pct: Number(a.annual_return ?? a.asset_types?.annual_return ?? 0),
  }));

  const saved = readSaved();
  // Rows for assets that no longer exist are removed
  saved.rows = saved.rows.filter((f) => assets.some((a) => a.id === f.assetId));
  if (saved.rows.length === 0 && assets.length > 0) saved.rows = [newRow(assets[0].id)];
  return { assets, saved, error: res.error ? res.error.message : "" };
}

// A typed amount: empty = 0; if it isn't valid or is negative, null
function amountOf(text: string): number | null {
  if (text.trim() === "") return 0;
  const n = parseInput(text);
  return n === null || n < 0 ? null : roundCents(n);
}

// The asset's own % as typed: "vacio" = uses the asset's one; null = not valid
function ownPctOf(text: string): number | "empty" | null {
  if (text.trim() === "") return "empty";
  const n = parseInput(text);
  return n === null || n <= -100 || n > 1000 ? null : n;
}

export default function SimulatorAnalysis() {
  const [open, setOpen] = useState(false);
  const [viewData, setViewData] = useState<ViewData | null>(null);
  const [years, setYears] = useState("10");
  const [rows, setRows] = useState<Row[]>([]);

  const show = useCallback((d: ViewData) => {
    setViewData(d);
    setYears(d.saved.years);
    setRows(d.saved.rows);
  }, []);

  // Only fetches the data the first time it's opened
  useEffect(() => {
    if (open && !viewData) fetchViewData().then(show);
  }, [open, viewData, show]);

  // Every change is remembered on this device
  useEffect(() => {
    if (!viewData) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ years, rows }));
    } catch {}
  }, [viewData, years, rows]);

  if (!viewData) {
    return (
      <Collapsible title={t("🧮 Simulador", "🧮 Simulator")} onOpen={setOpen}>
        <p className="opacity-70">{t("Cargando...", "Loading...")}</p>
      </Collapsible>
    );
  }

  const assetById = (id: string) => viewData.assets.find((a) => a.id === id);

  const nYears = parseNumber(years);
  const validYears = nYears !== null && Number.isInteger(nYears) && nYears >= 1 && nYears <= 50;
  const n = validYears ? nYears : 10;

  // What goes into the calculation (what isn't valid counts as 0, or the asset's %)
  const inputs = rows.map((f): SimulationRow => {
    const own = ownPctOf(f.pct);
    return {
      initial: amountOf(f.initial) ?? 0,
      contribution: amountOf(f.contribution) ?? 0,
      frequency: f.frequency,
      annualPct: typeof own === "number" ? own : (assetById(f.assetId)?.pct ?? 0),
    };
  });
  const series = simulationSeries(inputs, n);
  const last = series[series.length - 1];
  const gain = last.value - last.contributed;
  const relative = relativeGain(gain, last.contributed);
  const atStart = inputs.reduce((s, e) => s + e.initial, 0);
  const todayDate = today();
  const endDate = addMonths(todayDate, n * 12);

  const update = (key: string, changes: Partial<Row>) =>
    setRows(rows.map((f) => (f.key === key ? { ...f, ...changes } : f)));

  function startOver() {
    const question = t(
      "¿Borrar esta simulación y empezar de cero?",
      "Delete this simulation and start from scratch?",
    );
    if (!viewData || !window.confirm(question)) return;
    setRows(viewData.assets.length > 0 ? [newRow(viewData.assets[0].id)] : []);
  }

  return (
    <Collapsible
      title={t("🧮 Simulador", "🧮 Simulator")}
      summary={rows.length > 0 && <span className="font-bold">{euros(last.value)}</span>}
      onOpen={setOpen}
    >
      {viewData.error && <p className="text-red-500">{viewData.error}</p>}
      <p className="text-sm opacity-70">
        {t(
          "Calcula cuánto tendrías invirtiendo desde cero, sin contar lo que ya tienes. No cambia nada de tus datos.",
          "Work out how much you'd have investing from scratch, without counting what you already have. It doesn't change any of your data.",
        )}
      </p>

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

      {viewData.assets.length === 0 ? (
        <p className="text-sm opacity-70">
          {t(
            "Todavía no hay activos. Créalos en Ajustes.",
            "No assets yet. Create them in Settings.",
          )}
        </p>
      ) : (
        <>
          {/* ---------- Result ---------- */}
          {rows.length > 0 && (
            <>
              <div className="rounded bg-gray-500/10 p-3">
                <p className="text-sm opacity-70">
                  {t("En", "In")} {n} {n === 1 ? t("año", "year") : t("años", "years")} (
                  {monthName(endDate.slice(0, 7), language())})
                </p>
                <p className="text-2xl font-bold">{euros(last.value)}</p>
                <p className="text-sm opacity-70">
                  {t("Habrás puesto", "You'll have put in")} <span>{euros(last.contributed)}</span>:{" "}
                  <span>{euros(atStart)}</span> {t("al empezar", "at the start")} +{" "}
                  <span>{euros(last.contributed - atStart)}</span>{" "}
                  {t("en aportaciones", "in contributions")}
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
              </div>

              <EvolutionChart
                series={series.map((p) => ({
                  date: addMonths(todayDate, p.month),
                  value: p.value,
                  contributed: p.contributed,
                }))}
              />
            </>
          )}

          {/* ---------- Rows ---------- */}
          <ul className="flex flex-col gap-3">
            {rows.map((f, i) => {
              const asset = assetById(f.assetId);
              const initial = amountOf(f.initial);
              const contribution = amountOf(f.contribution);
              const own = ownPctOf(f.pct);
              const finalValue = simulatedValue(inputs[i], n);
              const putIn = simulatedContributed(inputs[i], n);
              return (
                <li
                  key={f.key}
                  className="flex flex-col gap-2 rounded border border-gray-400/50 p-3"
                >
                  <div className="flex gap-2">
                    <select
                      className={`${field} w-full min-w-0`}
                      aria-label={t("Activo", "Asset")}
                      value={f.assetId}
                      onChange={(e) => update(f.key, { assetId: e.target.value })}
                    >
                      {viewData.assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={t("Quitar este activo", "Remove this asset")}
                      onClick={() => setRows(rows.filter((x) => x.key !== f.key))}
                      className="shrink-0 rounded border border-gray-400 px-3 text-base"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-sm opacity-70">
                        {t("€ al empezar", "€ at the start")}
                      </span>
                      <input
                        className={`${field} w-full min-w-0 ${initial === null ? "border-red-500" : ""}`}
                        inputMode="decimal"
                        placeholder="0"
                        value={f.initial}
                        onChange={(e) => update(f.key, { initial: e.target.value })}
                      />
                    </label>
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-sm opacity-70">{t("% al año", "% a year")}</span>
                      <div className="flex gap-1">
                        <input
                          className={`${field} w-full min-w-0 ${own === null ? "border-red-500" : ""}`}
                          inputMode="decimal"
                          placeholder={pctText(asset?.pct ?? 0)}
                          value={f.pct}
                          onChange={(e) => update(f.key, { pct: e.target.value })}
                        />
                        <button
                          type="button"
                          aria-label={t("Cambiar el signo del %", "Change the sign of the %")}
                          onClick={() => update(f.key, { pct: toggleSign(f.pct) })}
                          className="shrink-0 rounded border border-gray-400 px-3 text-base"
                        >
                          ±
                        </button>
                      </div>
                    </label>
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-sm opacity-70">{t("Aportación", "Contribution")}</span>
                      <input
                        className={`${field} w-full min-w-0 ${contribution === null ? "border-red-500" : ""}`}
                        inputMode="decimal"
                        placeholder="0"
                        value={f.contribution}
                        onChange={(e) => update(f.key, { contribution: e.target.value })}
                      />
                    </label>
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-sm opacity-70">{t("Cada", "Every")}</span>
                      <select
                        className={`${field} w-full min-w-0`}
                        value={f.frequency}
                        onChange={(e) => update(f.key, { frequency: e.target.value as Frequency })}
                      >
                        {frequencies().map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.text}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {initial === null || contribution === null ? (
                    <p className="text-sm text-red-500">
                      {t(
                        "Los importes deben ser 0 o más, por ejemplo 150",
                        "Amounts must be 0 or more, e.g. 150",
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
                          {asset?.name ?? t("su activo", "its asset")} ({pctText(asset?.pct ?? 0)}
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
                        <span className={gainColor(finalValue - putIn)}>
                          {withSign(finalValue - putIn)}
                        </span>
                      </p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRows([...rows, newRow(viewData.assets[0].id)])}
              className="flex-1 rounded border border-gray-400 p-3 text-base"
            >
              {t("➕ Añadir activo", "➕ Add asset")}
            </button>
            {rows.length > 0 && (
              <button
                type="button"
                onClick={startOver}
                className="flex-1 rounded border border-gray-400 p-3 text-base"
              >
                {t("Empezar de cero", "Start from scratch")}
              </button>
            )}
          </div>
        </>
      )}

      <p className="text-xs opacity-60">
        {t(
          "Es una estimación: la rentabilidad real sube y baja cada año. Si dejas el % vacío, se usa el del activo. Cada periodo crece el equivalente al % anual y las aportaciones se hacen al principio de cada semana, mes o año (la primera, el primer día). La simulación se recuerda solo en este dispositivo.",
          "It's an estimate: real returns go up and down every year. If you leave the % empty, the asset's % is used. Each period grows the equivalent of the yearly % and contributions are made at the start of each week, month or year (the first one on day one). The simulation is remembered only on this device.",
        )}
      </p>
    </Collapsible>
  );
}
