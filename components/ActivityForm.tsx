"use client";

import { useState } from "react";
import type { MarketAsset } from "@/lib/portfolio";
import { calculateFee, currentFeeSchedule, type FeeSchedule } from "@/lib/fees";
import {
  parseNumber,
  button,
  field,
  roundCents,
  euros,
  prettyDate,
  today,
  numberToText,
  units as fmtPart,
} from "@/lib/format";
import { language, t } from "@/lib/language";
import { recalculateSplits, type SplitOp } from "@/lib/splits";
import { supabase } from "@/lib/supabase";

export type ActivityType = "buy" | "sell" | "dividend" | "split";

type SelectOption = { id: string; name: string };

// What gets saved for an activity (to edit an existing one)
export type EditableActivity = {
  id: string;
  asset_id: string;
  account_id: string | null;
  date: string;
  type: ActivityType;
  amount: number;
  fee: number;
  withholding: number;
  price: number | null;
  units: number | null;
  factor: number | null;
  notes: string | null;
  switch_id: string | null; // both parts of a fund switch share this id
};

export const TYPES: ActivityType[] = ["buy", "sell", "dividend", "split"];

// Name of each activity type in the chosen language
export function typeName(type: ActivityType): string {
  return {
    buy: t("Compra", "Buy"),
    sell: t("Venta", "Sell"),
    dividend: t("Dividendo", "Dividend"),
    split: "Split",
  }[type];
}

// Units held of an asset on a date (inclusive).
// When editing, "excludeId" leaves out the activity itself, so it isn't counted twice.
export async function unitsOnDate(
  assetId: string,
  date: string,
  excludeId?: string,
): Promise<number> {
  let q = supabase
    .from("transactions")
    .select("type, units")
    .eq("asset_id", assetId)
    .lte("date", date);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q;
  return (data ?? []).reduce((sum, o) => {
    const p = Number(o.units ?? 0);
    if (o.type === "sell") return sum - p;
    if (o.type === "buy" || o.type === "split") return sum + p;
    return sum;
  }, 0);
}

// Recalculates an asset's splits after creating, editing or deleting an activity.
// Returns one line for each split that changed (none if everything matched).
export async function adjustSplits(assetId: string, name: string): Promise<string[]> {
  const ops: SplitOp[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, date, type, units, factor")
      .eq("asset_id", assetId)
      .order("date")
      .order("id")
      .range(i, i + 999);
    if (error) throw new Error(error.message);
    ops.push(...((data ?? []) as SplitOp[]));
    if ((data ?? []).length < 1000) break;
  }
  const changes = recalculateSplits(ops);
  for (const c of changes) {
    const { error } = await supabase.from("transactions").update({ units: c.after }).eq("id", c.id);
    if (error) throw new Error(error.message);
  }
  return changes.map((c) =>
    t(
      `🔁 Recalculado el split del ${prettyDate(c.date)} de ${name}: suma ${fmtPart(c.after)} participaciones (antes ${fmtPart(c.before)})`,
      `🔁 Recalculated the ${prettyDate(c.date)} split of ${name}: adds ${fmtPart(c.after)} units (before ${fmtPart(c.before)})`,
    ),
  );
}

// Same, but without errors: if it fails, it says so in a line for you to see
export async function adjustSplitsWithNotice(assetId: string, name: string): Promise<string[]> {
  try {
    return await adjustSplits(assetId, name);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return [
      t(
        `⚠️ No se ha podido recalcular el split de ${name} (${reason}). Edítalo y pulsa «Guardar cambios».`,
        `⚠️ Could not recalculate the split of ${name} (${reason}). Edit it and press «Save changes».`,
      ),
    ];
  }
}

// 12.5 -> "12,5" (to fill in the fields when editing; in English, "12.5")
function text(n: number | null): string {
  return n === null ? "" : numberToText(Number(n));
}

// 12.5 -> "12,50" (in English, "12.50")
export function eurosText(n: number): string {
  const s = Number(n).toFixed(2);
  return language() === "en" ? s : s.replace(".", ",");
}

// Activity form. Without "activity" it creates a new one; with "activity" it edits it.
export default function ActivityForm({
  assets,
  accounts,
  feeSchedules,
  activity,
  onSave,
  onCancel,
}: {
  assets: MarketAsset[];
  accounts: SelectOption[];
  feeSchedules: FeeSchedule[];
  activity?: EditableActivity;
  onSave: (warnings: string[]) => void; // warnings: the splits that were recalculated
  onCancel?: () => void;
}) {
  const o = activity;
  const hasAmount = o && o.type !== "split";
  const [type, setType] = useState<ActivityType>(o?.type ?? "buy");
  const [assetId, setAssetId] = useState(o?.asset_id ?? "");
  const [date, setDate] = useState(o?.date ?? today());
  const [amount, setAmount] = useState(hasAmount ? eurosText(o.amount) : "");
  const [price, setPrice] = useState(o ? text(o.price) : "");
  const [unitCount, setUnitCount] = useState(o && o.type !== "split" ? text(o.units) : "");
  const [fee, setFee] = useState(hasAmount ? eurosText(o.fee) : "");
  const [withholding, setWithholding] = useState(hasAmount ? eurosText(o.withholding) : "");
  const [factor, setFactor] = useState(o ? text(o.factor) : "");
  const [accountId, setAccountId] = useState(o?.account_id ?? ""); // "" = no account
  const [notes, setNotes] = useState(o?.notes ?? "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const chosenAsset = assetId || assets[0]?.id || "";
  const asset = assets.find((a) => a.id === chosenAsset);

  // Amount, price and units: with two of them the third one is calculated
  const nAmount = parseNumber(amount);
  const nPrice = parseNumber(price);
  const nUnits = parseNumber(unitCount);
  const calculatedUnits =
    nAmount && nPrice && nPrice > 0 && unitCount.trim() === "" ? nAmount / nPrice : null;
  const calculatedAmount =
    amount.trim() === "" && nUnits && nPrice ? roundCents(nUnits * nPrice) : null;
  const effectiveAmount = nAmount ?? calculatedAmount;

  const feeSchedule = asset
    ? currentFeeSchedule(feeSchedules, asset.platform_id, asset.type_id, date)
    : null;
  const calculatedFee =
    effectiveAmount && asset
      ? calculateFee(feeSchedule, effectiveAmount, asset.currency !== "EUR")
      : 0;
  // When editing, the fee is already filled in: we warn if the fee schedule would give another one
  const nFee = parseNumber(fee);
  const feeDiffers = feeSchedule && nFee !== null && roundCents(nFee) !== roundCents(calculatedFee);

  function resetForm() {
    setAmount("");
    setPrice("");
    setUnitCount("");
    setFee("");
    setWithholding("");
    setFactor("");
    setNotes("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice([]);
    if (!asset) return;

    // All columns, so nothing from the previous type is left when the type changes
    let row: Record<string, unknown> = {
      asset_id: asset.id,
      date,
      type,
      amount: 0,
      fee: 0,
      withholding: 0,
      price: null,
      units: null,
      factor: null,
      account_id: null,
      notes: notes.trim() || null,
    };

    if (type === "buy" || type === "sell") {
      if (!nPrice || nPrice <= 0) {
        setError(
          t(
            "Escribe el precio por participación (mayor que 0)",
            "Enter the price per unit (over 0)",
          ),
        );
        return;
      }
      const amt = effectiveAmount;
      const p = unitCount.trim() === "" ? calculatedUnits : nUnits;
      if (!amt || amt <= 0 || !p || p <= 0) {
        setError(
          t(
            "Escribe el importe o las participaciones (mayores que 0)",
            "Enter the amount or the units (over 0)",
          ),
        );
        return;
      }
      const c = fee.trim() === "" ? calculatedFee : nFee;
      if (c === null || c < 0) {
        setError(t("La comisión debe ser 0 o mayor", "The fee must be 0 or more"));
        return;
      }
      if (type === "sell") {
        const held = await unitsOnDate(asset.id, date, o?.id);
        if (p > held + 1e-9) {
          setError(
            t(
              `En esa fecha solo tenías ${fmtPart(held)} participaciones de ${asset.name}`,
              `On that date you only had ${fmtPart(held)} units of ${asset.name}`,
            ),
          );
          return;
        }
      }
      row = {
        ...row,
        amount: roundCents(amt),
        price: nPrice,
        units: p,
        fee: roundCents(c),
        account_id: accountId || null,
      };
    }

    if (type === "dividend") {
      const r = withholding.trim() === "" ? 0 : parseNumber(withholding);
      if (!nAmount || nAmount <= 0) {
        setError(
          t(
            "Escribe el importe bruto del dividendo (mayor que 0)",
            "Enter the gross dividend (over 0)",
          ),
        );
        return;
      }
      if (r === null || r < 0 || r > nAmount) {
        setError(
          t(
            "La retención debe estar entre 0 y el importe bruto",
            "The withholding must be between 0 and the gross amount",
          ),
        );
        return;
      }
      row = {
        ...row,
        amount: roundCents(nAmount),
        withholding: roundCents(r),
        account_id: accountId || null,
      };
    }

    if (type === "split") {
      const f = parseNumber(factor);
      if (!f || f <= 0 || f === 1) {
        setError(
          t(
            "Escribe en cuántas se convierte cada participación (ej: 2, o 0,5)",
            "Enter how many units each unit becomes (e.g. 2, or 0.5)",
          ),
        );
        return;
      }
      const held = await unitsOnDate(asset.id, date, o?.id);
      if (held <= 0) {
        setError(
          t(
            `En esa fecha no tenías participaciones de ${asset.name}`,
            `On that date you had no units of ${asset.name}`,
          ),
        );
        return;
      }
      // We save the units that are added (or removed if f < 1)
      row = { ...row, factor: f, units: held * (f - 1) };
    }

    setSaving(true);
    const { error } = o
      ? await supabase.from("transactions").update(row).eq("id", o.id)
      : await supabase.from("transactions").insert(row);
    if (error) {
      setSaving(false);
      setError(error.message);
      return;
    }

    // If there are splits afterwards, their number of units may have changed.
    // When editing, if the activity changed asset, the previous asset too.
    const warnings = await adjustSplitsWithNotice(asset.id, asset.name);
    if (o && o.asset_id !== asset.id) {
      const dayBefore = assets.find((a) => a.id === o.asset_id);
      warnings.push(
        ...(await adjustSplitsWithNotice(
          o.asset_id,
          dayBefore?.name ?? t("otro activo", "another asset"),
        )),
      );
    }
    setSaving(false);

    if (!o) {
      setNotice([`✅ ${typeName(type)}: ${t("guardado", "saved")}`, ...warnings]);
      resetForm();
    }
    onSave(warnings);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        {TYPES.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setType(id);
              setError("");
              setNotice([]);
            }}
            className={`rounded border p-2 text-sm ${
              type === id
                ? "border-blue-600 bg-blue-600 font-semibold text-white"
                : "border-gray-400"
            }`}
          >
            {typeName(id)}
          </button>
        ))}
      </div>

      <label className="text-sm opacity-70">{t("Activo", "Asset")}</label>
      <select className={field} value={chosenAsset} onChange={(e) => setAssetId(e.target.value)}>
        {assets.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      <label className="text-sm opacity-70">
        {t("Fecha (puede ser antigua)", "Date (can be in the past)")}
      </label>
      <input
        className={field}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
      />

      {(type === "buy" || type === "sell") && (
        <>
          <p className="text-xs opacity-70">
            {t(
              "Rellena el precio y uno de los otros dos: el que dejes vacío se calcula solo.",
              "Fill in the price and one of the other two: the empty one is calculated for you.",
            )}
          </p>
          <label className="text-sm opacity-70">
            {t("Precio por participación (€)", "Price per unit (€)")}
          </label>
          <input
            className={field}
            inputMode="decimal"
            placeholder={t("Ej: 512,34", "e.g. 512.34")}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />

          <label className="text-sm opacity-70">
            {t("Importe en € (sin comisión)", "Amount in € (without fee)")}
          </label>
          <input
            className={field}
            inputMode="decimal"
            placeholder={
              calculatedAmount
                ? `${t("Calculado", "Calculated")}: ${euros(calculatedAmount)}`
                : t("Ej: 200", "e.g. 200")
            }
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          <label className="text-sm opacity-70">{t("Participaciones", "Units")}</label>
          <input
            className={field}
            inputMode="decimal"
            placeholder={
              calculatedUnits
                ? `${t("Calculadas", "Calculated")}: ${fmtPart(calculatedUnits)}`
                : t("Ej: 0,39", "e.g. 0.39")
            }
            value={unitCount}
            onChange={(e) => setUnitCount(e.target.value)}
          />

          <label className="text-sm opacity-70">
            {t("Comisión en € (vacío = la calculada)", "Fee in € (empty = the calculated one)")}
          </label>
          <input
            className={field}
            inputMode="decimal"
            placeholder={
              feeSchedule
                ? `${t("Según tarifa", "By fee schedule")}: ${euros(calculatedFee)}`
                : `${t("Sin tarifa", "No fee schedule")}: ${euros(0)}`
            }
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
          {feeDiffers && (
            <p className="text-xs opacity-70">
              {t("Según la tarifa serían", "The fee schedule gives")}{" "}
              <span>{euros(calculatedFee)}</span>
              {t(". Vacía la casilla para usarla.", ". Empty the box to use it.")}
            </p>
          )}
        </>
      )}

      {type === "dividend" && (
        <>
          <label className="text-sm opacity-70">
            {t("Importe bruto en €", "Gross amount in €")}
          </label>
          <input
            className={field}
            inputMode="decimal"
            placeholder={t("Ej: 12,50", "e.g. 12.50")}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <label className="text-sm opacity-70">
            {t("Retención de impuestos en € (opcional)", "Withholding tax in € (optional)")}
          </label>
          <input
            className={field}
            inputMode="decimal"
            placeholder={t("Ej: 2,38", "e.g. 2.38")}
            value={withholding}
            onChange={(e) => setWithholding(e.target.value)}
          />
        </>
      )}

      {type === "split" && (
        <>
          <label className="text-sm opacity-70">
            {t(
              "Cada participación se convierte en… (2 si se divide a la mitad; 0,5 si se agrupan de dos en dos)",
              "Each unit becomes… (2 if split in half; 0.5 if grouped two by two)",
            )}
          </label>
          <input
            className={field}
            inputMode="decimal"
            placeholder={t("Ej: 2", "e.g. 2")}
            value={factor}
            onChange={(e) => setFactor(e.target.value)}
          />
        </>
      )}

      {type !== "split" && (
        <>
          <label className="text-sm opacity-70">
            {type === "buy"
              ? t("Cuenta de la que salió el dinero", "Account the money came from")
              : t("Cuenta a la que entró el dinero", "Account the money went to")}
          </label>
          <select
            className={field}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">
              {t("Ninguna (no tocar ningún saldo)", "None (don't touch any balance)")}
            </option>
            {accounts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="text-xs opacity-70">
            {t(
              "Para operaciones antiguas elige «Ninguna»: el saldo actual de tus cuentas ya las tiene en cuenta.",
              "For old entries choose «None»: your current account balances already include them.",
            )}
          </p>
        </>
      )}

      <label className="text-sm opacity-70">{t("Notas (opcional)", "Notes (optional)")}</label>
      <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} />

      {error && <p className="text-red-500">{error}</p>}
      {notice.map((line) => (
        <p key={line} className={line.startsWith("⚠️") ? "text-orange-500" : "text-green-600"}>
          {line}
        </p>
      ))}

      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 rounded border border-gray-400 p-3 text-base"
          >
            {t("Cancelar", "Cancel")}
          </button>
        )}
        <button type="submit" disabled={saving} className={`${button} flex-1`}>
          {saving
            ? t("Guardando...", "Saving...")
            : o
              ? t("Guardar cambios", "Save changes")
              : t("Guardar", "Save")}
        </button>
      </div>
    </form>
  );
}
