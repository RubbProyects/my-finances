"use client";

import { useCallback, useEffect, useState } from "react";
import Collapsible from "@/components/Collapsible";
import { supabase } from "@/lib/supabase";
import type { FeeSchedule } from "@/lib/fees";
import { parseNumber, button, field, euros, prettyDate, today, numberToText } from "@/lib/format";
import { language, t } from "@/lib/language";
import { typeName } from "@/lib/asset-types";

type SelectOption = { id: string; name: string };

type ViewData = {
  feeSchedules: FeeSchedule[];
  platforms: SelectOption[];
  types: SelectOption[];
  error: string;
};

async function fetchViewData(): Promise<ViewData> {
  const [feeSchedulesRes, platformsRes, typesRes] = await Promise.all([
    supabase.from("fee_schedules").select("*").order("valid_from", { ascending: false }),
    supabase.from("platforms").select("id, name").order("name"),
    supabase
      .from("asset_types")
      .select("id, name, base_key")
      .eq("valuation", "market")
      .order("name"),
  ]);
  const failure = feeSchedulesRes.error || platformsRes.error || typesRes.error;
  return {
    feeSchedules: (feeSchedulesRes.data ?? []) as FeeSchedule[],
    platforms: (platformsRes.data ?? []) as SelectOption[],
    // The base types, with their name in the chosen language
    types: ((typesRes.data ?? []) as (SelectOption & { base_key: string | null })[]).map((tp) => ({
      id: tp.id,
      name: typeName(tp, language()) ?? tp.name,
    })),
    error: failure ? failure.message : "",
  };
}

// "0.12" -> "0,12 %" (in English, "0.12%")
function pct(n: number): string {
  return `${numberToText(Number(n))}${language() === "en" ? "%" : " %"}`;
}

// Text that summarizes a fee schedule: "0,12 % · mín. 1,00 € · máx. 25,00 € · divisa 0,3 %"
function feeScheduleSummary(tf: FeeSchedule): string {
  return [
    pct(tf.percent),
    Number(tf.fixed) > 0 && `+ ${euros(tf.fixed)} ${t("fijo", "fixed")}`,
    Number(tf.minimum) > 0 && `${t("mín.", "min.")} ${euros(tf.minimum)}`,
    tf.maximum !== null && `${t("máx.", "max.")} ${euros(tf.maximum)}`,
    Number(tf.fx_percent) > 0 && `${t("divisa", "FX")} ${pct(tf.fx_percent)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function FeeSchedules() {
  const [feeSchedules, setFeeSchedules] = useState<FeeSchedule[]>([]);
  const [platforms, setPlatforms] = useState<SelectOption[]>([]);
  const [types, setTypes] = useState<SelectOption[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Form
  const [platformId, setPlatformId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [from, setFrom] = useState(today);
  const [percent, setPercent] = useState("");
  const [fixed, setFixed] = useState("");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [fxPct, setFxPct] = useState("");

  const chosenPlatform = platformId || platforms[0]?.id || "";
  const chosenType = typeId || types[0]?.id || "";

  const show = useCallback((d: ViewData) => {
    setError(d.error);
    setFeeSchedules(d.feeSchedules);
    setPlatforms(d.platforms);
    setTypes(d.types);
  }, []);

  useEffect(() => {
    fetchViewData().then(show);
  }, [show]);

  const name = (list: SelectOption[], id: string) => list.find((x) => x.id === id)?.name ?? "?";

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // Empty fields count as 0 (empty maximum = no maximum)
    const values = [percent, fixed, minimum, fxPct].map((v) =>
      v.trim() === "" ? 0 : parseNumber(v),
    );
    const max = maximum.trim() === "" ? null : parseNumber(maximum);
    if (
      values.some((v) => v === null || v < 0) ||
      (maximum.trim() !== "" && (max === null || max < 0))
    ) {
      setError(
        t(
          "Revisa los números: deben ser 0 o mayores (ej: 0,12)",
          "Check the numbers: they must be 0 or more (e.g. 0.12)",
        ),
      );
      return;
    }
    const [vPct, vFixed, vMin, vFx] = values as number[];
    if (max !== null && max < vMin) {
      setError(
        t(
          "El máximo no puede ser menor que el mínimo",
          "The maximum can't be lower than the minimum",
        ),
      );
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("fee_schedules").insert({
      platform_id: chosenPlatform,
      type_id: chosenType,
      valid_from: from,
      percent: vPct,
      fixed: vFixed,
      minimum: vMin,
      maximum: max,
      fx_percent: vFx,
    });
    setSaving(false);
    if (error) {
      setError(
        error.code === "23505"
          ? t(
              "Ya hay una tarifa para esa plataforma y tipo con esa misma fecha",
              "There's already a fee schedule for that platform and type on that date",
            )
          : error.message,
      );
      return;
    }
    setPercent("");
    setFixed("");
    setMinimum("");
    setMaximum("");
    setFxPct("");
    fetchViewData().then(show);
  }

  async function remove(tf: FeeSchedule) {
    const question = t(
      "¿Borrar esta tarifa? Las operaciones ya guardadas no cambian.",
      "Delete this fee schedule? Activity already saved doesn't change.",
    );
    if (!confirm(question)) return;
    setError("");
    const { error } = await supabase.from("fee_schedules").delete().eq("id", tf.id);
    if (error) {
      setError(error.message);
      return;
    }
    fetchViewData().then(show);
  }

  return (
    <Collapsible
      title={t("💶 Tarifas de comisión", "💶 Fee schedules")}
      summary={<span className="text-sm opacity-60">{feeSchedules.length}</span>}
    >
      <p className="text-sm opacity-70">
        {t(
          "Sirven para proponer la comisión de cada compra o venta. Si una tarifa cambia, añade otra con la nueva fecha: las operaciones antiguas no se tocan. Sin tarifa, la comisión propuesta es 0 €.",
          "They suggest the fee for each buy or sell. If a fee changes, add another one with the new date: old activity isn't touched. With no fee schedule, the suggested fee is €0.",
        )}
      </p>
      {error && <p className="mb-3 text-red-500">{error}</p>}

      <Collapsible nested title={t("Mis tarifas", "My fee schedules")} open>
        {feeSchedules.length === 0 ? (
          <p className="mb-4 opacity-70">{t("Todavía no hay ninguna.", "None yet.")}</p>
        ) : (
          <ul className="mb-4 flex flex-col gap-2">
            {feeSchedules.map((tf) => (
              <li
                key={tf.id}
                className="flex items-center justify-between gap-3 rounded border border-gray-400 p-3"
              >
                <div>
                  <p className="font-semibold">
                    {name(platforms, tf.platform_id)} · {name(types, tf.type_id)}
                  </p>
                  <p className="text-sm opacity-70">{feeScheduleSummary(tf)}</p>
                  <p className="text-sm opacity-70">
                    {t("Desde el", "From")} {prettyDate(tf.valid_from)}
                  </p>
                </div>
                <button onClick={() => remove(tf)} className="text-sm text-red-500 underline">
                  {t("Borrar", "Delete")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Collapsible>
      <Collapsible nested title={t("➕ Añadir tarifa", "➕ Add fee schedule")}>
        <form onSubmit={add} className="flex flex-col gap-3">
          <label className="text-sm opacity-70">{t("Plataforma", "Platform")}</label>
          <select
            value={chosenPlatform}
            onChange={(e) => setPlatformId(e.target.value)}
            className={field}
          >
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <label className="text-sm opacity-70">{t("Tipo de activo", "Asset type")}</label>
          <select value={chosenType} onChange={(e) => setTypeId(e.target.value)} className={field}>
            {types.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.name}
              </option>
            ))}
          </select>

          <label className="text-sm opacity-70">{t("En vigor desde", "In force from")}</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            required
            className={field}
          />

          <label className="text-sm opacity-70">
            {t("% por operación (ej: 0,12)", "% per trade (e.g. 0.12)")}
          </label>
          <input
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            inputMode="decimal"
            className={field}
          />

          <label className="text-sm opacity-70">
            {t("Fijo por operación en € (opcional)", "Fixed per trade in € (optional)")}
          </label>
          <input
            value={fixed}
            onChange={(e) => setFixed(e.target.value)}
            inputMode="decimal"
            className={field}
          />

          <label className="text-sm opacity-70">
            {t("Mínimo en € (opcional)", "Minimum in € (optional)")}
          </label>
          <input
            value={minimum}
            onChange={(e) => setMinimum(e.target.value)}
            inputMode="decimal"
            className={field}
          />

          <label className="text-sm opacity-70">
            {t("Máximo en € (vacío = sin máximo)", "Maximum in € (empty = no maximum)")}
          </label>
          <input
            value={maximum}
            onChange={(e) => setMaximum(e.target.value)}
            inputMode="decimal"
            className={field}
          />

          <label className="text-sm opacity-70">
            {t(
              "% por cambio de divisa (si el activo no está en euros)",
              "% for currency exchange (if the asset isn't in euros)",
            )}
          </label>
          <input
            value={fxPct}
            onChange={(e) => setFxPct(e.target.value)}
            inputMode="decimal"
            className={field}
          />

          <button
            type="submit"
            disabled={saving || !chosenPlatform || !chosenType}
            className={button}
          >
            {saving ? t("Guardando...", "Saving...") : t("Añadir tarifa", "Add fee schedule")}
          </button>
        </form>
      </Collapsible>
    </Collapsible>
  );
}
