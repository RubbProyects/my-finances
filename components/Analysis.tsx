"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TaxAnalysis from "@/components/TaxAnalysis";
import SpendingAnalysis from "@/components/SpendingAnalysis";
import ProjectionAnalysis from "@/components/ProjectionAnalysis";
import SimulatorAnalysis from "@/components/SimulatorAnalysis";
import Collapsible from "@/components/Collapsible";
import EvolutionChart from "@/components/EvolutionChart";
import {
  dayChange,
  totalDayChange,
  periodReturn,
  portfolioSeries,
  addDays,
  assetValueAt,
  type AssetInfo,
  type Op,
  type DayPrice,
} from "@/lib/analysis";
import { gainColor, withSign, euros, today, pctWithSign, percent } from "@/lib/format";
import { language, t } from "@/lib/language";
import { toggle } from "@/lib/spending";
import { supabase } from "@/lib/supabase";
import { typeName } from "@/lib/asset-types";

type Asset = AssetInfo & {
  asset_types: { name: string; base_key: string | null; valuation: string } | null;
  platforms: { name: string } | null;
  categories: { name: string } | null;
};

type ViewData = {
  assets: Asset[];
  balances: Map<string, number>;
  ops: Op[];
  prices: Map<string, DayPrice[]>;
  error: string;
};

// Supabase returns at most 1000 rows per request: we fetch page by page
async function fetchAllPages<T>(
  page: (
    from: number,
    until: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await page(i, i + 999);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}

async function fetchViewData(): Promise<ViewData> {
  try {
    const [assetsRes, balancesRes, ops, prices] = await Promise.all([
      supabase
        .from("assets")
        .select(
          "id, name, price_source, asset_types(name, base_key, valuation), platforms(name), categories(name)",
        )
        .order("created_at"),
      supabase.from("account_balances").select("account_id, balance"),
      fetchAllPages<Op>((d, h) =>
        supabase
          .from("transactions")
          .select("asset_id, date, type, amount, fee, withholding, units, factor")
          .order("date")
          .order("id")
          .range(d, h),
      ),
      fetchAllPages<DayPrice & { asset_id: string }>((d, h) =>
        supabase
          .from("prices")
          .select("asset_id, date, price")
          .order("asset_id")
          .order("date")
          .range(d, h),
      ),
    ]);
    const failure = assetsRes.error || balancesRes.error;
    const byAsset = new Map<string, DayPrice[]>();
    for (const p of prices) {
      const list = byAsset.get(p.asset_id) ?? [];
      list.push({ date: p.date, price: Number(p.price) });
      byAsset.set(p.asset_id, list);
    }
    return {
      assets: (assetsRes.data ?? []) as unknown as Asset[],
      balances: new Map((balancesRes.data ?? []).map((s) => [s.account_id, Number(s.balance)])),
      ops: ops.map((o) => ({ ...o, amount: Number(o.amount), fee: Number(o.fee) })),
      prices: byAsset,
      error: failure ? failure.message : "",
    };
  } catch (e) {
    return {
      assets: [],
      balances: new Map(),
      ops: [],
      prices: new Map(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const GROUPINGS = [
  { id: "type", text: "Tipo", en: "Type" },
  { id: "platform", text: "Plataforma", en: "Platform" },
  { id: "category", text: "Categoría", en: "Category" },
  { id: "asset", text: "Activo", en: "Asset" },
] as const;
type Grouping = (typeof GROUPINGS)[number]["id"];

const PERIODS = [
  { id: "1d", text: "1 día", en: "1 day", days: 1 }, // from the previous price to the latest one of each asset
  { id: "7d", text: "7 días", en: "7 days", days: 7 },
  { id: "1m", text: "1 mes", en: "1 month", days: 30 },
  { id: "3m", text: "3 meses", en: "3 months", days: 91 },
  { id: "1a", text: "1 año", en: "1 year", days: 365 },
  { id: "ytd", text: "Este año", en: "This year", days: 0 },
  { id: "todo", text: "Todo", en: "All", days: 0 },
] as const;
type Period = (typeof PERIODS)[number]["id"];

function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { id: T; text: string; en: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`rounded-full border px-3 py-1 text-sm ${
            value === o.id
              ? "border-blue-600 bg-blue-600 font-semibold text-white"
              : "border-gray-400"
          }`}
        >
          {t(o.text, o.en)}
        </button>
      ))}
    </div>
  );
}

// "A", "A y B", "A, B y C" (in English, "A, B and C")
function joinList(texts: string[]): string {
  return texts.length < 2
    ? (texts[0] ?? "")
    : `${texts.slice(0, -1).join(", ")} ${t("y", "and")} ${texts[texts.length - 1]}`;
}

export default function Analysis() {
  const [viewData, setViewData] = useState<ViewData | null>(null);
  const [grouping, setGrouping] = useState<Grouping>("type");
  const [investmentsOnly, setInvestmentsOnly] = useState(false);
  const [period, setPeriod] = useState<Period>("1m");
  // Multiple selection: empty list = everything
  const [chosenGroups, setChosenGroups] = useState<string[]>([]);
  const [chosenAssets, setChosenAssets] = useState<string[]>([]);

  // When the grouping changes, what was chosen no longer makes sense
  const changeGrouping = (v: Grouping) => {
    setGrouping(v);
    setChosenGroups([]);
  };

  const show = useCallback((d: ViewData) => setViewData(d), []);
  useEffect(() => {
    fetchViewData().then(show);
  }, [show]);

  const todayText = today();

  // ---------- Capital allocation ----------
  const allocation = useMemo(() => {
    if (!viewData) return { groups: [], total: 0, chosenIds: [], chosenTotal: 0 };
    const groups = new Map<string, number>();
    for (const a of viewData.assets) {
      const isMarket = a.asset_types?.valuation === "market";
      if (investmentsOnly && !isMarket) continue;
      const value = isMarket
        ? assetValueAt(a, viewData.ops, viewData.prices.get(a.id) ?? [], todayText)
        : (viewData.balances.get(a.id) ?? 0);
      if (value <= 0) continue;
      const key =
        grouping === "type"
          ? (typeName(a.asset_types, language()) ?? t("Sin tipo", "No type"))
          : grouping === "platform"
            ? (a.platforms?.name ?? t("Sin plataforma", "No platform"))
            : grouping === "category"
              ? (a.categories?.name ?? t("Sin categoría", "No category"))
              : a.name;
      groups.set(key, (groups.get(key) ?? 0) + value);
    }
    const list = [...groups.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((x, y) => y.value - x.value);
    // Only counts what is chosen and still in the list (it may disappear when ticking "Investments only")
    const chosenIds = chosenGroups.filter((n) => groups.has(n));
    const total = list.reduce((s, g) => s + g.value, 0);
    const chosenTotal = chosenIds.length
      ? list.filter((g) => chosenIds.includes(g.name)).reduce((s, g) => s + g.value, 0)
      : total;
    return { groups: list, total, chosenIds, chosenTotal };
  }, [viewData, grouping, investmentsOnly, todayText, chosenGroups]);

  // ---------- Return for the period ----------
  const annualReturn = useMemo(() => {
    if (!viewData || viewData.ops.length === 0) return null;
    const marketAssets = viewData.assets.filter((a) => a.asset_types?.valuation === "market");
    const first = viewData.ops[0].date;
    const p = PERIODS.find((x) => x.id === period)!;
    let from =
      period === "todo"
        ? first
        : period === "ytd"
          ? `${todayText.slice(0, 4)}-01-01`
          : addDays(todayText, -p.days + 1);
    // "1 day": each asset, from its previous price to its latest price (funds usually run
    // one day behind ETFs)
    const day =
      period === "1d"
        ? new Map(
            marketAssets.map((a) => [
              a.id,
              dayChange(a, viewData.ops, viewData.prices.get(a.id) ?? [], todayText),
            ]),
          )
        : null;
    if (day) {
      const previousDates = [...day.values()].flatMap((x) => (x ? [x.previous] : [])).sort();
      from = previousDates.length > 0 ? addDays(previousDates[0], 1) : todayText;
    }
    if (from < first) from = first;

    const valueOn = (a: AssetInfo, f: string) =>
      assetValueAt(a, viewData.ops, viewData.prices.get(a.id) ?? [], f);
    const dayBefore = addDays(from, -1);

    const byAsset = marketAssets
      .map((a) => {
        if (day) {
          const x = day.get(a.id);
          return x ? { a, gain: x.gain, pct: x.pct } : null;
        }
        const ops = viewData.ops.filter((o) => o.asset_id === a.id);
        const v0 = valueOn(a, dayBefore);
        const v1 = valueOn(a, todayText);
        if (v0 === 0 && v1 === 0 && !ops.some((o) => o.date >= from)) return null;
        return { a, ...periodReturn(v0, v1, ops, from, todayText) };
      })
      .filter((x) => x !== null)
      .sort((x, y) => y.gain - x.gain);

    // Only the chosen assets that appear in the list count; if none is left, all of them
    const chosenIds = chosenAssets.filter((id) => byAsset.some((r) => r.a.id === id));
    const assets = chosenIds.length
      ? marketAssets.filter((a) => chosenIds.includes(a.id))
      : marketAssets;
    const ops = chosenIds.length
      ? viewData.ops.filter((o) => chosenIds.includes(o.asset_id))
      : viewData.ops;
    // In "All", the chart starts at the first activity of what is chosen
    // In "1 day", the chart starts at the previous price
    const start =
      period === "todo" && ops.length > 0 ? ops[0].date : day ? addDays(from, -1) : from;
    const dayBeforeStart = addDays(start, -1);

    const series = portfolioSeries(assets, ops, viewData.prices, start, todayText);
    const total = day
      ? totalDayChange(assets.flatMap((a) => day.get(a.id) ?? []))
      : periodReturn(
          assets.reduce((s, a) => s + valueOn(a, dayBeforeStart), 0),
          assets.reduce((s, a) => s + valueOn(a, todayText), 0),
          ops,
          start,
          todayText,
        );
    const names = assets.filter((a) => chosenIds.includes(a.id)).map((a) => a.name);
    return {
      series,
      total,
      byAsset,
      from,
      chosenIds,
      names,
    };
  }, [viewData, period, todayText, chosenAssets]);

  if (!viewData) return <p>{t("Cargando...", "Loading...")}</p>;

  return (
    <div className="flex flex-col gap-3">
      {viewData.error && <p className="text-red-500">{viewData.error}</p>}

      {/* ---------- ALLOCATION ---------- */}
      <Collapsible
        title={t("🥧 Reparto del capital", "🥧 Allocation")}
        open
        summary={<span className="font-bold">{euros(allocation.chosenTotal)}</span>}
      >
        <Chips options={GROUPINGS} value={grouping} onChange={changeGrouping} />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={investmentsOnly}
            onChange={(e) => setInvestmentsOnly(e.target.checked)}
          />
          {t("Solo inversiones (sin cuentas)", "Investments only (no accounts)")}
        </label>
        {allocation.groups.length === 0 ? (
          <p className="text-sm opacity-70">
            {t("Todavía no hay nada que repartir.", "Nothing to allocate yet.")}
          </p>
        ) : (
          <>
            {allocation.chosenIds.length > 0 ? (
              <div className="rounded-lg border border-blue-600 p-3 text-sm">
                <p>
                  {t("Lo elegido", "Selected")}:{" "}
                  <span className="font-bold">{euros(allocation.chosenTotal)}</span>
                </p>
                <p className="opacity-70">
                  {percent((allocation.chosenTotal / allocation.total) * 100)}{" "}
                  {t("de todo", "of everything")} (<span>{euros(allocation.total)}</span>).{" "}
                  {t("Los % de abajo son sobre lo elegido.", "The % below are of the selection.")}
                </p>
                <button
                  type="button"
                  onClick={() => setChosenGroups([])}
                  className="text-blue-600 underline"
                >
                  {t("Ver todo", "Show all")}
                </button>
              </div>
            ) : (
              <p className="text-xs opacity-60">
                {t(
                  "Toca una o varias filas para quedarte solo con ellas.",
                  "Tap one or more rows to keep only those.",
                )}
              </p>
            )}
            <ul className="flex flex-col gap-3">
              {allocation.groups.map((g) => {
                const chosen = allocation.chosenIds.includes(g.name);
                const dimmed = allocation.chosenIds.length > 0 && !chosen;
                const pct = dimmed ? 0 : (g.value / allocation.chosenTotal) * 100;
                return (
                  <li key={g.name} className={dimmed ? "opacity-40" : ""}>
                    <button
                      type="button"
                      onClick={() => setChosenGroups(toggle(chosenGroups, g.name))}
                      aria-pressed={chosen}
                      className="flex w-full flex-col gap-1 text-left"
                    >
                      <div className="flex w-full justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">
                          {chosen && <span className="mr-1 font-bold text-blue-600">✓</span>}
                          {g.name}
                        </span>
                        <span className="shrink-0">
                          <span className="font-semibold">{euros(g.value)}</span>
                          {!dimmed && <span className="opacity-70"> · {percent(pct)}</span>}
                        </span>
                      </div>
                      <div className="h-2 w-full rounded bg-gray-400/20">
                        {pct > 0 && (
                          <div
                            className="h-2 rounded bg-[#2a78d6] dark:bg-[#3987e5]"
                            style={{ width: `${Math.max(pct, 1)}%` }}
                          />
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Collapsible>

      {/* ---------- RETURNS ---------- */}
      <Collapsible title={t("📈 Rentabilidad", "📈 Returns")} open>
        <Chips options={PERIODS} value={period} onChange={setPeriod} />
        {!annualReturn ? (
          <p className="text-sm opacity-70">
            {t("Todavía no hay operaciones de inversión.", "No investment activity yet.")}
          </p>
        ) : (
          <>
            <div>
              <p className="text-sm opacity-70">
                {annualReturn.chosenIds.length > 0
                  ? `${t("Ganancia en el periodo · solo", "Gain in the period · only")} ${joinList(annualReturn.names)}`
                  : t("Ganancia en el periodo", "Gain in the period")}
                {period === "1d" &&
                  ` · ${t("desde el precio anterior de cada activo", "since each asset's previous price")}`}
              </p>
              <p className={`text-2xl font-bold ${gainColor(annualReturn.total.gain)}`}>
                {withSign(annualReturn.total.gain)}
              </p>
              {annualReturn.total.pct !== null && (
                <p className={`text-sm font-semibold ${gainColor(annualReturn.total.gain)}`}>
                  {pctWithSign(annualReturn.total.pct)}
                </p>
              )}
              {annualReturn.chosenIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setChosenAssets([])}
                  className="text-sm text-blue-600 underline"
                >
                  {t("Todos los activos", "All assets")}
                </button>
              )}
            </div>

            <EvolutionChart series={annualReturn.series} />

            <p className="text-sm font-semibold">{t("Por activo", "By asset")}</p>
            {annualReturn.chosenIds.length === 0 && (
              <p className="text-xs opacity-60">
                {t(
                  "Toca uno o varios activos para ver solo su rentabilidad.",
                  "Tap one or more assets to see only their returns.",
                )}
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {annualReturn.byAsset.map((r) => {
                const chosen = annualReturn.chosenIds.includes(r.a.id);
                const dimmed = annualReturn.chosenIds.length > 0 && !chosen;
                return (
                  <li key={r.a.id} className={dimmed ? "opacity-40" : ""}>
                    <button
                      type="button"
                      onClick={() => setChosenAssets(toggle(chosenAssets, r.a.id))}
                      aria-pressed={chosen}
                      className="flex w-full items-center justify-between gap-3 text-left text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {chosen && <span className="mr-1 font-bold text-blue-600">✓</span>}
                        {r.a.name}
                      </span>
                      <span className={`shrink-0 font-semibold ${gainColor(r.gain)}`}>
                        <span>{withSign(r.gain)}</span>
                        {r.pct !== null ? ` (${pctWithSign(r.pct)})` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs opacity-60">
              {t(
                "El % descuenta el dinero que metes o sacas durante el periodo (método Modified Dietz), así una compra nueva no cuenta como ganancia.",
                "The % discounts money you put in or take out during the period (Modified Dietz method), so a new purchase doesn't count as a gain.",
              )}
            </p>
          </>
        )}
      </Collapsible>

      {/* ---------- TAX ---------- */}
      <TaxAnalysis />

      {/* ---------- SPENDING ---------- */}
      <SpendingAnalysis />

      {/* ---------- PROJECTION ---------- */}
      <ProjectionAnalysis />

      {/* ---------- SIMULATOR ---------- */}
      <SimulatorAnalysis />
    </div>
  );
}
