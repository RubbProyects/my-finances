"use client";

import { useState } from "react";
import {
  adjustSplitsWithNotice,
  unitsOnDate,
  eurosText,
  type EditableActivity,
} from "@/components/ActivityForm";
import type { MarketAsset } from "@/lib/portfolio";
import {
  parseNumber,
  button,
  field,
  euros,
  prettyDate,
  today,
  numberToText,
  units as fmtPart,
  price as fmtPrice,
} from "@/lib/format";
import { language, t } from "@/lib/language";
import { supabase } from "@/lib/supabase";
import { switchCandidates, switchError, switchRows } from "@/lib/switches";

// 12.5 -> "12,5" (to fill in the fields when editing; in English, "12.5")
function text(n: number | null): string {
  return n === null ? "" : numberToText(Number(n));
}

// When linking a sale and a buy already recorded, they may not match like a fund switch made here
function differ(v: EditableActivity, c: EditableActivity): boolean {
  return (
    Number(v.amount) !== Number(c.amount) ||
    Number(v.fee) !== 0 ||
    Number(c.fee) !== 0 ||
    v.account_id !== null ||
    c.account_id !== null
  );
}

// Fund switch form. Without "pair" it creates a new one; with "pair" it edits both parts.
export default function SwitchForm({
  assets,
  pair,
  onSave,
  onCancel,
}: {
  assets: MarketAsset[];
  pair?: { sale: EditableActivity; buy: EditableActivity };
  onSave: (warnings: string[]) => void; // warnings: the splits that were recalculated
  onCancel?: () => void;
}) {
  const v = pair?.sale;
  const c = pair?.buy;
  const [sourceAssetId, setSourceAssetId] = useState(v?.asset_id ?? assets[0]?.id ?? "");
  const [targetAssetId, setTargetAssetId] = useState(
    c?.asset_id ?? assets.find((a) => a.id !== sourceAssetId)?.id ?? "",
  );
  const [outDate, setOutDate] = useState(v?.date ?? today());
  const [inDate, setInDate] = useState(c && c.date !== v?.date ? c.date : ""); // "" = the same
  const [amount, setAmount] = useState(v ? eurosText(v.amount) : "");
  const [unitsOut, setUnitsOut] = useState(v ? text(v.units) : "");
  const [unitsIn, setUnitsIn] = useState(c ? text(c.units) : "");
  const [notes, setNotes] = useState(v?.notes ?? "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const name = (id: string) =>
    assets.find((a) => a.id === id)?.name ?? t("otro activo", "another asset");
  const nAmount = parseNumber(amount);
  const nUnitsOut = parseNumber(unitsOut);
  const nUnitsIn = parseNumber(unitsIn);

  // Puts in "unitsOut" all the units held of the source on that day
  async function fillAllUnits() {
    setError("");
    const n = await unitsOnDate(sourceAssetId, outDate, v?.id);
    if (n <= 0)
      setError(
        t(
          `El ${prettyDate(outDate)} no tenías participaciones de ${name(sourceAssetId)}`,
          `On ${prettyDate(outDate)} you had no units of ${name(sourceAssetId)}`,
        ),
      );
    else setUnitsOut(text(Math.round(n * 1e6) / 1e6));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice([]);
    const d = {
      source: sourceAssetId,
      target: targetAssetId,
      outDate,
      inDate: inDate || outDate,
      amount: nAmount ?? 0,
      unitsOut: nUnitsOut ?? 0,
      unitsIn: nUnitsIn ?? 0,
      notes,
    };
    const failure = switchError(d, language());
    if (failure) {
      setError(failure);
      return;
    }
    const held = await unitsOnDate(sourceAssetId, outDate, v?.id);
    if (d.unitsOut > held + 1e-9) {
      setError(
        t(
          `El ${prettyDate(outDate)} solo tenías ${fmtPart(held)} participaciones de ${name(sourceAssetId)}`,
          `On ${prettyDate(outDate)} you only had ${fmtPart(held)} units of ${name(sourceAssetId)}`,
        ),
      );
      return;
    }

    setSaving(true);
    const [saleRow, buyRow] = switchRows(d, v?.switch_id ?? crypto.randomUUID());
    // Both parts in a single request: either both are saved or neither
    const { error } = pair
      ? await supabase.from("transactions").upsert([
          { ...saleRow, id: pair.sale.id },
          { ...buyRow, id: pair.buy.id },
        ])
      : await supabase.from("transactions").insert([saleRow, buyRow]);
    if (error) {
      setSaving(false);
      setError(error.message);
      return;
    }

    // If there are splits afterwards, their number of units may have changed
    const touched = new Set([
      sourceAssetId,
      targetAssetId,
      ...(pair ? [pair.sale.asset_id, pair.buy.asset_id] : []),
    ]);
    const warnings: string[] = [];
    for (const id of touched) warnings.push(...(await adjustSplitsWithNotice(id, name(id))));
    setSaving(false);

    if (!pair) {
      setNotice([
        `${t("Traspaso guardado", "Switch saved")}: ${name(sourceAssetId)} → ${name(targetAssetId)}`,
        ...warnings,
      ]);
      setAmount("");
      setUnitsOut("");
      setUnitsIn("");
      setNotes("");
    }
    onSave(warnings);
  }

  // Leaves the sale and the buy as separate activities (deletes nothing)
  async function unlink() {
    if (!pair?.sale.switch_id) return;
    const question = t(
      "¿Separar el traspaso? La venta y la compra se quedan como operaciones sueltas.",
      "Split up the switch? The sell and the buy stay as separate entries.",
    );
    if (!confirm(question)) return;
    setSaving(true);
    const { error } = await supabase
      .from("transactions")
      .update({ switch_id: null })
      .eq("switch_id", pair.sale.switch_id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSave([]);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <p className="text-xs opacity-70">
        {t(
          "Se apunta la venta del fondo de origen y la compra en el de destino, sin comisión y sin tocar ninguna cuenta. En un traspaso no pagas impuestos: conservas el coste y la fecha de tus compras.",
          "It records the sell of the source fund and the buy of the target fund, with no fee and without touching any account. A switch is tax-free in Spain: you keep the cost and date of your purchases.",
        )}
      </p>
      {v && c && differ(v, c) && (
        <p className="text-sm text-orange-500">
          {t("⚠️ La venta", "⚠️ The sell")} (<span>{euros(v.amount)}</span>){" "}
          {t("y la compra", "and the buy")} (<span>{euros(c.amount)}</span>){" "}
          {t(
            "no son iguales o tienen comisión o cuenta. Si guardas, las dos quedarán con el importe que escribas, sin comisión y sin cuenta. Si no quieres eso, pulsa «Cancelar».",
            "don't match or have a fee or account. If you save, both will have the amount you enter, with no fee and no account. If you don't want that, press «Cancel».",
          )}
        </p>
      )}

      <label className="text-sm opacity-70">
        {t("Fondo de origen (sale el dinero)", "Source fund (money out)")}
      </label>
      <select
        className={field}
        value={sourceAssetId}
        onChange={(e) => setSourceAssetId(e.target.value)}
      >
        {assets.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      <label className="text-sm opacity-70">
        {t("Fondo de destino (entra el dinero)", "Target fund (money in)")}
      </label>
      <select
        className={field}
        value={targetAssetId}
        onChange={(e) => setTargetAssetId(e.target.value)}
      >
        {assets.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      <label className="text-sm opacity-70">
        {t("Fecha de salida (venta)", "Date out (sell)")}
      </label>
      <input
        className={field}
        type="date"
        value={outDate}
        onChange={(e) => setOutDate(e.target.value)}
        required
      />

      <label className="text-sm opacity-70">
        {t("Fecha de entrada (compra)", "Date in (buy)")}
      </label>
      <input
        className={field}
        type="date"
        value={inDate || outDate}
        onChange={(e) => setInDate(e.target.value === outDate ? "" : e.target.value)}
        required
      />
      <p className="text-xs opacity-70">
        {t(
          "Suele llegar unos días después. Si no lo sabes, deja la misma fecha.",
          "It usually arrives a few days later. If you don't know, leave the same date.",
        )}
      </p>

      <label className="text-sm opacity-70">
        {t("Importe traspasado en €", "Amount switched in €")}
      </label>
      <input
        className={field}
        inputMode="decimal"
        placeholder={t("Ej: 1.000", "e.g. 1,000")}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />

      <div className="flex items-baseline justify-between gap-3">
        <label className="text-sm opacity-70">{t("Participaciones que salen", "Units out")}</label>
        <button type="button" onClick={fillAllUnits} className="text-sm text-accent underline">
          {t("Todas", "All")}
        </button>
      </div>
      <input
        className={field}
        inputMode="decimal"
        placeholder={t("Ej: 2,5", "e.g. 2.5")}
        value={unitsOut}
        onChange={(e) => setUnitsOut(e.target.value)}
      />

      <label className="text-sm opacity-70">{t("Participaciones que entran", "Units in")}</label>
      <input
        className={field}
        inputMode="decimal"
        placeholder={t("Ej: 31,2", "e.g. 31.2")}
        value={unitsIn}
        onChange={(e) => setUnitsIn(e.target.value)}
      />

      {nAmount && nAmount > 0 && (nUnitsOut || nUnitsIn) ? (
        <p className="text-xs opacity-70">
          {nUnitsOut && nUnitsOut > 0
            ? `${t("Precio de salida", "Price out")} ${fmtPrice(nAmount / nUnitsOut)}`
            : ""}
          {nUnitsOut && nUnitsOut > 0 && nUnitsIn && nUnitsIn > 0 ? " · " : ""}
          {nUnitsIn && nUnitsIn > 0
            ? `${t("Precio de entrada", "Price in")} ${fmtPrice(nAmount / nUnitsIn)}`
            : ""}
        </p>
      ) : null}

      <label className="text-sm opacity-70">{t("Notas (opcional)", "Notes (optional)")}</label>
      <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} />

      {error && <p className="text-down">{error}</p>}
      {notice.map((line) => (
        <p key={line} className={line.startsWith("⚠️") ? "text-orange-500" : "text-up"}>
          {line}
        </p>
      ))}

      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 rounded-xl border border-line bg-surface p-3 text-base"
          >
            {t("Cancelar", "Cancel")}
          </button>
        )}
        <button type="submit" disabled={saving} className={`${button} flex-1`}>
          {saving
            ? t("Guardando...", "Saving...")
            : pair
              ? t("Guardar cambios", "Save changes")
              : t("Guardar traspaso", "Save switch")}
        </button>
      </div>
      {pair && (
        <button
          type="button"
          onClick={unlink}
          disabled={saving}
          className="self-start text-sm text-down underline disabled:opacity-50"
        >
          {t("Separar en venta y compra sueltas", "Split into separate sell and buy")}
        </button>
      )}
    </form>
  );
}

// For a sale already recorded: pick the buy that was the other half of the fund switch and link them.
// It doesn't change amounts, fees or accounts: it only marks them as a fund switch.
export function LinkSwitch({
  sale,
  activities,
  name,
  onSave,
  onCancel,
}: {
  sale: EditableActivity;
  activities: EditableActivity[];
  name: (assetId: string) => string;
  onSave: () => void;
  onCancel: () => void;
}) {
  const candidates = switchCandidates(sale, activities);
  const [chosen, setChosen] = useState(candidates[0]?.id ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function link() {
    if (!chosen) return;
    setError("");
    setSaving(true);
    const { error } = await supabase
      .from("transactions")
      .update({ switch_id: crypto.randomUUID() })
      .in("id", [sale.id, chosen]);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSave();
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent p-2 text-sm">
      <p className="font-semibold">
        {t(
          "🔁 ¿A qué compra fue el dinero de esta venta?",
          "🔁 Which buy did this sell's money go to?",
        )}
      </p>
      {candidates.length === 0 ? (
        <p className="opacity-70">
          {t(
            "No hay ninguna compra de otro fondo entre 5 días antes y 30 días después. Apunta primero la compra, o borra la venta y apúntalo como «Traspaso».",
            "There's no buy of another fund from 5 days before to 30 days after. Add the buy first, or delete the sell and record it as a «Fund switch».",
          )}
        </p>
      ) : (
        <>
          <select className={field} value={chosen} onChange={(e) => setChosen(e.target.value)}>
            {candidates.map((o) => (
              <option key={o.id} value={o.id}>
                {prettyDate(o.date)} · {name(o.asset_id)} · {euros(o.amount)}
              </option>
            ))}
          </select>
          <p className="text-xs opacity-70">
            {t(
              "Solo las marca como traspaso: los importes, la comisión y la cuenta no cambian.",
              "It only marks them as a switch: amounts, fee and account don't change.",
            )}
          </p>
        </>
      )}
      {error && <p className="text-down">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 rounded-xl border border-line bg-surface p-3 text-base"
        >
          {t("Cancelar", "Cancel")}
        </button>
        {candidates.length > 0 && (
          <button onClick={link} disabled={saving} className={`${button} flex-1`}>
            {saving ? t("Enlazando...", "Linking...") : t("Enlazar", "Link")}
          </button>
        )}
      </div>
    </div>
  );
}
