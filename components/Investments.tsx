"use client";

import { useCallback, useEffect, useState } from "react";
import Collapsible from "@/components/Collapsible";
import PositionChart from "@/components/PositionChart";
import ActivityForm, {
  adjustSplitsWithNotice,
  typeName,
  type EditableActivity,
} from "@/components/ActivityForm";
import SwitchForm, { LinkSwitch } from "@/components/SwitchForm";
import { dayChange, totalDayChange, type DayChange, type Op } from "@/lib/analysis";
import PricesStamp from "@/components/PricesStamp";
import { callApi } from "@/lib/api";
import {
  fetchPortfolio,
  portfolioTotals,
  type MarketAsset,
  type PortfolioRow,
} from "@/lib/portfolio";
import type { FeeSchedule } from "@/lib/fees";
import {
  parseNumber,
  button,
  field,
  gainColor,
  withSign,
  euros,
  prettyDate,
  today,
  numberToText,
  units as fmtPart,
  pctWithSign,
  price as fmtPrice,
} from "@/lib/format";
import { language, t } from "@/lib/language";
import { translateMessage } from "@/lib/messages";
import { supabase } from "@/lib/supabase";
import { pairOf } from "@/lib/switches";

type SelectOption = { id: string; name: string };

// The activity as saved, plus the names of its asset and its account
type Activity = EditableActivity & {
  asset: { name: string } | null;
  account: { name: string } | null;
};

const ACTIVITY_FIELDS =
  "id, asset_id, account_id, date, type, amount, fee, withholding, price, units, factor, notes, switch_id, asset:assets!asset_id(name), account:assets!account_id(name)";

const PAGE_SIZE = 50;

type ViewData = {
  assets: MarketAsset[];
  rows: PortfolioRow[];
  accounts: SelectOption[];
  feeSchedules: FeeSchedule[];
  activities: Activity[];
  days: Map<string, DayChange>; // how much each asset went up or down on its last day
  error: string;
};

// All activities, from the most recent to the oldest.
// Supabase returns at most 1000 rows per request: we fetch page by page.
async function fetchActivities(): Promise<{ activities: Activity[]; error: string }> {
  const activities: Activity[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select(ACTIVITY_FIELDS)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(i, i + 999);
    if (error) return { activities, error: error.message };
    const batch = (data ?? []) as unknown as Activity[];
    activities.push(...batch);
    if (batch.length < 1000) return { activities, error: "" };
  }
}

async function fetchViewData(): Promise<ViewData> {
  const [portfolio, accountsRes, feeSchedulesRes, opsRes] = await Promise.all([
    fetchPortfolio(),
    supabase
      .from("assets")
      .select("id, name, asset_types!inner(valuation)")
      .eq("asset_types.valuation", "balance")
      .order("created_at"),
    supabase.from("fee_schedules").select("*"),
    fetchActivities(),
  ]);
  const failure = [accountsRes, feeSchedulesRes].map((r) => r.error).find(Boolean);

  // The last two prices of each asset, to see how much it changed on its last day
  const todayText = today();
  const ops: Op[] = opsRes.activities.map((o) => ({
    asset_id: o.asset_id,
    date: o.date,
    type: o.type,
    amount: Number(o.amount),
    fee: Number(o.fee),
    withholding: Number(o.withholding),
    units: o.units === null ? null : Number(o.units),
    factor: o.factor === null ? null : Number(o.factor),
  }));
  const days = new Map<string, DayChange>();
  await Promise.all(
    portfolio.rows.map(async (f) => {
      const { data } = await supabase
        .from("prices")
        .select("date, price")
        .eq("asset_id", f.a.id)
        .lte("date", todayText)
        .order("date", { ascending: false })
        .limit(2);
      const prices = ((data ?? []) as { date: string; price: number }[])
        .map((p) => ({ date: p.date, price: Number(p.price) }))
        .reverse();
      const c = dayChange(f.a, ops, prices, todayText);
      if (c) days.set(f.a.id, c);
    }),
  );

  return {
    assets: portfolio.assets,
    rows: portfolio.rows,
    accounts: (accountsRes.data ?? []) as unknown as SelectOption[],
    feeSchedules: (feeSchedulesRes.data ?? []) as FeeSchedule[],
    activities: opsRes.activities,
    days,
    error: portfolio.error || (failure ? failure.message : "") || opsRes.error,
  };
}

// Detail text for an activity
function activityDetail(o: Activity): string {
  if (o.type === "buy" || o.type === "sell")
    return `${fmtPart(Number(o.units))} × ${fmtPrice(Number(o.price))} · ${t("comisión", "fee")} ${euros(o.fee)}`;
  if (o.type === "dividend")
    return `${t("Bruto", "Gross")} ${euros(o.amount)} · ${t("retención", "withholding")} ${euros(o.withholding)}`;
  return `1 → ${numberToText(Number(o.factor))} · ${Number(o.units) >= 0 ? "+" : ""}${fmtPart(Number(o.units))} ${t("participaciones", "units")}`;
}

/* ------------------------------------------------------------------ */
/* History of an asset, with what each buy has gained until today     */
/* ------------------------------------------------------------------ */
function AssetHistory({
  assetId,
  priceToday,
  version,
}: {
  assetId: string;
  priceToday: number | null;
  version: number; // changes when an activity is saved, edited or deleted, to fetch them again
}) {
  const [ops, setOps] = useState<Activity[] | null>(null);

  useEffect(() => {
    supabase
      .from("transactions")
      .select(ACTIVITY_FIELDS)
      .eq("asset_id", assetId)
      .order("date")
      .order("created_at")
      .then(({ data }) => setOps((data ?? []) as unknown as Activity[]));
  }, [assetId, version]);

  if (!ops)
    return <p className="text-sm opacity-70">{t("Cargando historial...", "Loading history...")}</p>;
  if (ops.length === 0)
    return <p className="text-sm opacity-70">{t("Sin operaciones.", "No activity.")}</p>;

  // If there was a split after a buy, those units were multiplied
  const factorSince = (date: string) =>
    ops
      .filter((o) => o.type === "split" && o.date >= date)
      .reduce((f, o) => f * Number(o.factor ?? 1), 1);

  return (
    <ul className="flex flex-col gap-2">
      {[...ops].reverse().map((o) => {
        let result: { value: number; gain: number; pct: number } | null = null;
        if (o.type === "buy" && priceToday !== null) {
          const cost = Number(o.amount) + Number(o.fee);
          const value = Number(o.units) * factorSince(o.date) * priceToday;
          result = { value, gain: value - cost, pct: ((value - cost) / cost) * 100 };
        }
        return (
          <li key={o.id} className="rounded-xl border border-line p-2 text-sm">
            <div className="flex justify-between gap-3">
              <p className="font-medium">
                {typeName(o.type)}
                {o.switch_id ? ` (${t("traspaso", "switch")})` : ""} · {prettyDate(o.date)}
              </p>
              {o.type !== "split" && <p className="font-semibold">{euros(o.amount)}</p>}
            </div>
            <p className="opacity-70">{activityDetail(o)}</p>
            {result && (
              <p className={gainColor(result.gain)}>
                {t("Hoy vale", "Worth today")} <span>{euros(result.value)}</span> ·{" "}
                <span>{withSign(result.gain)}</span> ({pctWithSign(result.pct)})
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// "Hoy +12,30 € (+0,45 %)": how much it went up or down on its last day with a price
function DayLine({
  day,
  className = "",
}: {
  day: { gain: number; pct: number | null; date?: string };
  className?: string;
}) {
  const when =
    !day.date || day.date === today()
      ? t("Hoy", "Today")
      : `${t("El", "On")} ${prettyDate(day.date).slice(0, 5)}`;
  return (
    <span className={`${className} ${gainColor(day.gain)}`}>
      {when} <span>{withSign(day.gain)}</span>
      {day.pct !== null ? ` (${pctWithSign(day.pct)})` : ""}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Card for a portfolio asset                                         */
/* ------------------------------------------------------------------ */
function AssetCard({
  f,
  day,
  version,
  onChange,
}: {
  f: PortfolioRow;
  day: DayChange | null;
  version: number;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState(false);
  const [newPrice, setNewPrice] = useState("");
  const [error, setError] = useState("");
  const { a, pos, latest: last, value, gain, pct } = f;

  async function savePrice(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const p = parseNumber(newPrice);
    if (!p || p <= 0) {
      setError(t("El precio debe ser un número mayor que 0", "The price must be a number over 0"));
      return;
    }
    const { error } = await supabase
      .from("prices")
      .upsert({ asset_id: a.id, date: today(), price: p }, { onConflict: "asset_id,date" });
    if (error) {
      setError(error.message);
      return;
    }
    setEditingPrice(false);
    setNewPrice("");
    onChange();
  }

  const source =
    a.price_source === "ft"
      ? "Financial Times"
      : a.price_source === "yahoo" && a.ticker
        ? `Yahoo ${a.ticker}`
        : t("precio manual", "manual price");

  return (
    <Collapsible
      nested
      onOpen={setOpen}
      title={
        <span>
          <span className="block">{a.name}</span>
          {last && (
            <span className="block text-sm font-semibold">
              {fmtPrice(last.price)}
              <span className="font-normal opacity-70"> {t("/ participación", "/ unit")}</span>
            </span>
          )}
          <span className="block text-sm font-normal opacity-70">{a.platforms?.name ?? ""}</span>
        </span>
      }
      summary={
        value !== null && gain !== null ? (
          <span>
            <span className="block font-bold">{euros(value)}</span>
            <span className={`block text-sm ${gainColor(gain)}`}>
              <span>{withSign(gain)}</span>
              {pct !== null ? ` (${pctWithSign(pct)})` : ""}
            </span>
            {day && <DayLine day={day} className="block text-xs" />}
          </span>
        ) : (
          <span className="text-sm opacity-70">{t("Sin precio", "No price")}</span>
        )
      }
    >
      {open && <PositionChart assetId={a.id} version={version} />}
      <div className="text-sm opacity-80">
        <p>
          {fmtPart(pos.units)} {t("participaciones", "units")} · {t("coste", "cost")}{" "}
          {euros(pos.bought)}
          {pos.sold > 0 ? ` · ${t("vendido", "sold")} ${euros(pos.sold)}` : ""}
          {pos.dividends > 0 ? ` · ${t("dividendos", "dividends")} ${euros(pos.dividends)}` : ""}
        </p>
        <p>
          {last
            ? `${t("Precio", "Price")} ${fmtPrice(last.price)} (${prettyDate(last.date)})`
            : t("Sin precio todavía", "No price yet")}{" "}
          · {source}
        </p>
      </div>
      {a.price_status && (
        <p className="text-sm text-orange-500">⚠️ {translateMessage(a.price_status, language())}</p>
      )}
      {error && <p className="text-sm text-down">{error}</p>}

      {editingPrice ? (
        <form onSubmit={savePrice} className="flex gap-2">
          <input
            className={`${field} min-w-0 flex-1`}
            inputMode="decimal"
            placeholder={t("Precio de hoy", "Today's price")}
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            autoFocus
          />
          <button type="submit" className={button}>
            {t("Guardar", "Save")}
          </button>
          <button
            type="button"
            onClick={() => setEditingPrice(false)}
            className="rounded-xl border border-line bg-surface p-3"
          >
            ✕
          </button>
        </form>
      ) : (
        <button onClick={() => setEditingPrice(true)} className="self-start text-sm underline">
          {t("Actualizar precio a mano", "Update price by hand")}
        </button>
      )}

      <p className="text-sm font-semibold">{t("Historial de operaciones", "Activity history")}</p>
      {open && <AssetHistory assetId={a.id} priceToday={last?.price ?? null} version={version} />}
    </Collapsible>
  );
}

/* ------------------------------------------------------------------ */
/* Main screen                                                        */
/* ------------------------------------------------------------------ */
export default function Investments() {
  const [viewData, setViewData] = useState<ViewData | null>(null);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);
  const [report, setReport] = useState<string[]>([]);
  const [version, setVersion] = useState(0); // goes up on each reload, for each asset's history
  const [editing, setEditing] = useState<string | null>(null); // id of the activity being edited
  const [linking, setLinking] = useState<string | null>(null); // sale being marked as a fund switch
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [warnings, setWarnings] = useState<string[]>([]); // splits recalculated when editing or deleting

  const show = useCallback((d: ViewData) => {
    setViewData(d);
    setError(d.error);
    setVersion((v) => v + 1);
  }, []);
  const reload = useCallback(() => {
    fetchViewData().then(show);
  }, [show]);

  useEffect(() => {
    fetchViewData().then(show);
  }, [show]);

  if (!viewData) return <p>{t("Cargando...", "Loading...")}</p>;

  const { assets, rows, accounts, feeSchedules, activities } = viewData;
  const total = portfolioTotals(rows);
  const changes = [...viewData.days.values()];
  const dayTotal = changes.length > 0 ? totalDayChange(changes) : null;
  // If all assets have their latest price on the same day, it says which; if not, "Today"
  const dayDates = [...new Set(changes.map((c) => c.date))];

  // When an activity's changes are saved: closes the form and reloads
  function afterSave(lines: string[]) {
    setEditing(null);
    setLinking(null);
    setWarnings(lines);
    reload();
  }

  async function remove(o: Activity) {
    // A fund switch is deleted as a whole: the sale and the buy
    const pair = pairOf(o, activities);
    const [sale, buy] = o.type === "sell" ? [o, pair] : [pair, o];
    const text = pair
      ? t(
          `¿Borrar el traspaso de ${sale?.asset?.name ?? "?"} a ${buy?.asset?.name ?? "?"}? Se borran la venta y la compra.`,
          `Delete the switch from ${sale?.asset?.name ?? "?"} to ${buy?.asset?.name ?? "?"}? Both the sell and the buy are deleted.`,
        )
      : o.type === "split"
        ? t("¿Borrar este split?", "Delete this split?")
        : t(
            `¿Borrar ${typeName(o.type).toLowerCase()} de ${euros(o.amount)}?`,
            `Delete this ${typeName(o.type).toLowerCase()} of ${euros(o.amount)}?`,
          );
    if (!confirm(text)) return;
    setError("");
    setWarnings([]);
    const { error } = pair
      ? await supabase.from("transactions").delete().eq("switch_id", o.switch_id)
      : await supabase.from("transactions").delete().eq("id", o.id);
    if (error) {
      setError(error.message);
      return;
    }
    // If there were splits afterwards, their number of units may have changed
    const lines = await adjustSplitsWithNotice(
      o.asset_id,
      o.asset?.name ?? t("este activo", "this asset"),
    );
    if (pair) lines.push(...(await adjustSplitsWithNotice(pair.asset_id, pair.asset?.name ?? "?")));
    setWarnings(lines);
    reload();
  }

  async function updateNow() {
    setError("");
    setReport([]);
    setUpdating(true);
    try {
      const r = await callApi<{
        results: { name: string; added: number; error: string | null }[];
      }>("/api/prices", "POST");
      setReport(
        r.results.length === 0
          ? [
              t(
                "Ningún activo tiene fuente automática: configúrala en Ajustes → Editar",
                "No asset has an automatic price source: set it in Settings → Edit",
              ),
            ]
          : r.results.map((x) =>
              x.error
                ? `⚠️ ${x.name}: ${translateMessage(x.error, language())}`
                : `✅ ${x.name}: ${x.added} ${t("precios", "prices")}`,
            ),
      );
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setUpdating(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ---------- TOTAL ---------- */}
      <div className="rounded-xl border border-line bg-surface p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm opacity-70">
              {t("Valor de mis inversiones", "My investments' value")}
            </p>
            <p className="text-2xl font-bold">{euros(total.value)}</p>
            {rows.length > 0 && (
              <p className={`text-sm font-semibold ${gainColor(total.gain)}`}>
                <span>{withSign(total.gain)}</span>
                {total.pct !== null ? ` (${pctWithSign(total.pct)})` : ""}
              </p>
            )}
            {dayTotal && (
              <DayLine
                day={{ ...dayTotal, date: dayDates.length === 1 ? dayDates[0] : undefined }}
                className="block text-sm"
              />
            )}
          </div>
          <button
            onClick={updateNow}
            disabled={updating}
            className="text-sm underline disabled:opacity-50"
          >
            {updating
              ? t("Actualizando...", "Updating...")
              : t("🔄 Actualizar precios", "🔄 Update prices")}
          </button>
        </div>
        <PricesStamp className="mt-2 text-xs" />
        {total.noPrice > 0 && (
          <p className="mt-1 text-xs opacity-70">
            {t(
              `No incluye ${total.noPrice} activo(s) sin precio.`,
              `Leaves out ${total.noPrice} asset(s) with no price.`,
            )}
          </p>
        )}
        {report.length > 0 && (
          <ul className="mt-2 text-sm">
            {report.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-down">{error}</p>}

      {/* ---------- ASSETS ---------- */}
      {rows.length === 0 ? (
        <p className="opacity-70">
          {t(
            "Todavía no hay operaciones. Añádelas en «Nueva operación», también las antiguas.",
            "No activity yet. Add it in «New activity», including old entries.",
          )}
        </p>
      ) : (
        rows.map((f) => (
          <AssetCard
            key={f.a.id}
            f={f}
            day={viewData.days.get(f.a.id) ?? null}
            version={version}
            onChange={reload}
          />
        ))
      )}

      {/* ---------- NEW ACTIVITY ---------- */}
      <Collapsible title={t("➕ Nueva operación", "➕ New activity")}>
        {assets.length === 0 ? (
          <p className="opacity-70">
            {t(
              "Todavía no tienes ningún activo: búscalo en Mercados y pulsa «Apuntar una operación» (se crea solo). También puedes crearlo en Ajustes.",
              "You don't have any asset yet: find it in Markets and tap «Record an activity» (it creates itself). You can also create one in Settings.",
            )}
          </p>
        ) : (
          <ActivityForm
            assets={assets}
            accounts={accounts}
            feeSchedules={feeSchedules}
            onSave={() => {
              setWarnings([]); // the form already shows its own warnings
              reload();
            }}
          />
        )}
      </Collapsible>

      {/* ---------- NEW FUND SWITCH ---------- */}
      <Collapsible title={t("🔁 Traspaso entre fondos", "🔁 Fund switch")}>
        {assets.length < 2 ? (
          <p className="opacity-70">
            {t(
              "Necesitas al menos dos activos que coticen.",
              "You need at least two listed assets.",
            )}
          </p>
        ) : (
          <SwitchForm
            assets={assets}
            onSave={() => {
              setWarnings([]); // the form already shows its own warnings
              reload();
            }}
          />
        )}
      </Collapsible>

      {/* ---------- HISTORY ---------- */}
      <Collapsible
        title={t("🕘 Historial de operaciones", "🕘 Activity history")}
        summary={<span className="text-sm opacity-60">{activities.length}</span>}
      >
        {warnings.map((line) => (
          <p
            key={line}
            className={`text-sm ${line.startsWith("⚠️") ? "text-orange-500" : "text-up"}`}
          >
            {line}
          </p>
        ))}
        {activities.length === 0 ? (
          <p className="opacity-70">{t("Todavía no hay operaciones.", "No activity yet.")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {activities.slice(0, visibleCount).map((o) => {
              const pair = pairOf(o, activities);
              if (editing === o.id && pair)
                return (
                  <li key={o.id} className="rounded-xl border border-accent p-3">
                    <p className="mb-3 font-semibold">
                      {t("✏️ Editar traspaso", "✏️ Edit switch")}
                    </p>
                    <SwitchForm
                      assets={assets}
                      pair={o.type === "sell" ? { sale: o, buy: pair } : { sale: pair, buy: o }}
                      onSave={afterSave}
                      onCancel={() => setEditing(null)}
                    />
                  </li>
                );
              if (linking === o.id)
                return (
                  <li key={o.id}>
                    <LinkSwitch
                      sale={o}
                      activities={activities}
                      name={(id) => assets.find((a) => a.id === id)?.name ?? "?"}
                      onSave={() => afterSave([])}
                      onCancel={() => setLinking(null)}
                    />
                  </li>
                );
              return editing === o.id ? (
                <li key={o.id} className="rounded-xl border border-accent p-3">
                  <p className="mb-3 font-semibold">
                    {t("✏️ Editar operación", "✏️ Edit activity")}
                  </p>
                  <ActivityForm
                    assets={assets}
                    accounts={accounts}
                    feeSchedules={feeSchedules}
                    activity={o}
                    onSave={afterSave}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line p-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {typeName(o.type)} · {o.asset?.name ?? "?"}
                    </p>
                    <p className="opacity-70">
                      {prettyDate(o.date)}
                      {o.account ? ` · ${o.account.name}` : ""}
                    </p>
                    {pair && (
                      <p className="opacity-70">
                        {o.type === "sell"
                          ? t("🔁 Traspaso a", "🔁 Switch to")
                          : t("🔁 Traspaso desde", "🔁 Switch from")}{" "}
                        {pair.asset?.name ?? "?"}
                      </p>
                    )}
                    <p className="opacity-70">{activityDetail(o)}</p>
                    {o.notes && <p className="opacity-70">{o.notes}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {o.type !== "split" && <p className="font-bold">{euros(o.amount)}</p>}
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setEditing(o.id);
                          setLinking(null);
                          setWarnings([]);
                        }}
                        className="text-accent underline"
                      >
                        {t("Editar", "Edit")}
                      </button>
                      <button onClick={() => remove(o)} className="text-down underline">
                        {t("Borrar", "Delete")}
                      </button>
                    </div>
                    {o.type === "sell" && !o.switch_id && (
                      <button
                        onClick={() => {
                          setLinking(o.id);
                          setEditing(null);
                          setWarnings([]);
                        }}
                        className="text-accent underline"
                      >
                        {t("🔁 Fue un traspaso", "🔁 It was a switch")}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {activities.length > visibleCount && (
          <button
            onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
            className="rounded-xl border border-line bg-surface p-3 text-base"
          >
            {t("Ver más", "Show more")} ({activities.length - visibleCount} {t("más", "more")})
          </button>
        )}
      </Collapsible>
    </div>
  );
}
