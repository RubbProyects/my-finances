"use client";

import { useCallback, useEffect, useState } from "react";
import SymbolSearch from "@/components/SymbolSearch";
import Collapsible from "@/components/Collapsible";
import { parseNumber, button, field, prettyDate, numberToText } from "@/lib/format";
import { language, t } from "@/lib/language";
import { supabase } from "@/lib/supabase";
import { typeName as baseTypeName, BASE_TYPES } from "@/lib/asset-types";

type Valuation = "market" | "balance";
type Identifier = "isin" | "symbol" | "none";
type PriceSource = "yahoo" | "ft" | "manual";

type Item = { id: string; name: string };

type AssetType = {
  id: string;
  name: string;
  base_key: string | null; // base type (its name is shown in each language); null = created by the user
  valuation: Valuation;
  identifier: Identifier;
  has_maturity: boolean;
  annual_return: number;
};

type Asset = {
  id: string;
  name: string;
  isin: string | null;
  ticker: string | null;
  price_source: PriceSource;
  maturity_date: string | null;
  currency: string;
  annual_return: number | null;
  asset_types: Omit<AssetType, "id"> | null;
  platforms: { name: string } | null;
  categories: { name: string } | null;
};

// Shows 2.75 as "2,75" (in English, "2.75")
function formatPct(n: number): string {
  return numberToText(Number(n));
}

// " %" in Spanish, "%" in English
const pctSign = () => (language() === "en" ? "%" : " %");

// Checks that an ISIN has the right format and its check digit matches
function isValidIsin(isin: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false;
  // Each letter becomes a number (A=10, B=11...) and the Luhn algorithm is applied
  const digits = isin
    .slice(0, 11)
    .split("")
    .map((c) => parseInt(c, 36))
    .join("");
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(isin[11]);
}

// Name of a type in the chosen language (base types are translated; yours aren't)
const nt = (type: { name: string; base_key: string | null }) =>
  baseTypeName(type, language()) ?? "";

// Base types first, in their order; then yours
const typeOrder = (type: { base_key: string | null }) => {
  const i = BASE_TYPES.findIndex((b) => b.base_key === type.base_key);
  return i === -1 ? BASE_TYPES.length : i;
};

// Normalizes what was typed: no spaces and in capitals
function cleanCode(text: string): string {
  return text.replace(/\s/g, "").toUpperCase();
}

const identifierText = (i: Identifier): string =>
  ({
    isin: t("Pide ISIN", "Needs ISIN"),
    symbol: t("Pide símbolo", "Needs symbol"),
    none: t("Sin identificador", "No identifier"),
  })[i];

// Validates ISIN / symbol / maturity depending on the type. Returns an error message or "".
function validateFields(
  type: AssetType | Omit<AssetType, "id"> | null | undefined,
  isin: string,
  ticker: string,
  source: PriceSource,
): string {
  if (!type) return "";
  if (type.valuation === "market" && source === "ft" && !isValidIsin(isin))
    return t(
      "Financial Times busca por ISIN: escribe un ISIN válido",
      "Financial Times searches by ISIN: enter a valid ISIN",
    );
  if (type.identifier === "isin") {
    if (!isin)
      return t(
        "El ISIN es obligatorio para este tipo de activo",
        "The ISIN is required for this asset type",
      );
    if (!isValidIsin(isin))
      return t(
        "El ISIN no es válido: revisa que tenga 12 caracteres y esté bien copiado",
        "The ISIN isn't valid: check it has 12 characters and is copied correctly",
      );
  }
  if (type.identifier === "symbol" && source !== "manual" && !ticker)
    return t(
      "El símbolo es obligatorio para este tipo de activo (ej: BTC-EUR)",
      "The symbol is required for this asset type (e.g. BTC-EUR)",
    );
  return "";
}

/* ------------------------------------------------------------------ */
/* Simple list (used for platforms and for categories)                */
/* ------------------------------------------------------------------ */
function SimpleList({
  title,
  table,
  items,
  example,
  onChange,
  onError,
}: {
  title: string;
  table: "platforms" | "categories";
  items: Item[];
  example: string;
  onChange: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    onError("");
    setSaving(true);
    const { error } = await supabase.from(table).insert({ name: name.trim() });
    if (error) {
      onError(
        error.code === "23505"
          ? t("Ya existe uno con ese nombre", "One with that name already exists")
          : error.message,
      );
    } else {
      setName("");
      onChange();
    }
    setSaving(false);
  }

  async function remove(item: Item) {
    if (!confirm(t(`¿Borrar "${item.name}"?`, `Delete "${item.name}"?`))) return;
    onError("");
    const { error } = await supabase.from(table).delete().eq("id", item.id);
    if (error) {
      onError(
        error.code === "23503"
          ? t("No se puede borrar: hay activos que lo usan", "Can't delete it: some assets use it")
          : error.message,
      );
    } else {
      onChange();
    }
  }

  return (
    <Collapsible title={title} summary={<span className="text-sm opacity-60">{items.length}</span>}>
      {items.length === 0 ? (
        <p className="mb-4 opacity-70">{t("Todavía no hay ninguno.", "None yet.")}</p>
      ) : (
        <ul className="mb-4 flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between rounded border border-gray-400 p-3"
            >
              <p className="font-semibold">{item.name}</p>
              <button onClick={() => remove(item)} className="text-sm text-red-500 underline">
                {t("Borrar", "Delete")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-col gap-3">
        <input
          placeholder={`${t("Añadir (ej:", "Add (e.g.")} ${example})`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={field}
        />
        <button type="submit" disabled={saving} className={button}>
          {saving ? t("Guardando...", "Saving...") : t("Añadir", "Add")}
        </button>
      </form>
    </Collapsible>
  );
}

/* ------------------------------------------------------------------ */
/* ISIN / symbol / maturity fields depending on the type              */
/* (used when adding and when editing an asset)                       */
/* ------------------------------------------------------------------ */
function TypeFields({
  type,
  isin,
  setIsin,
  ticker,
  setTicker,
  source,
  setSource,
  maturity,
  setMaturity,
}: {
  type: Omit<AssetType, "id"> | null | undefined;
  isin: string;
  setIsin: (v: string) => void;
  ticker: string;
  setTicker: (v: string) => void;
  source: PriceSource;
  setSource: (v: PriceSource) => void;
  maturity: string;
  setMaturity: (v: string) => void;
}) {
  if (!type) return null;
  return (
    <>
      {type.identifier === "isin" && (
        <>
          <label className="text-sm opacity-70">
            {t(
              "ISIN (obligatorio, 12 caracteres; lo ves en la ficha del producto)",
              "ISIN (required, 12 characters; see the product's factsheet)",
            )}
          </label>
          <input
            placeholder={t("Ej: IE00B5BMR087", "e.g. IE00B5BMR087")}
            value={isin}
            onChange={(e) => setIsin(e.target.value)}
            autoCapitalize="characters"
            className={field}
          />
        </>
      )}

      {type.valuation === "market" && (
        <>
          <label className="text-sm opacity-70">{t("Fuente del precio", "Price source")}</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as PriceSource)}
            className={field}
          >
            <option value="yahoo">
              {t("Yahoo Finance (ETF, acciones, crypto)", "Yahoo Finance (ETFs, stocks, crypto)")}
            </option>
            <option value="ft">
              {t(
                "Financial Times (fondos indexados, por ISIN)",
                "Financial Times (funds, by ISIN)",
              )}
            </option>
            <option value="manual">{t("Manual (lo apunto yo)", "Manual (I enter it)")}</option>
          </select>

          {source === "yahoo" && (
            <>
              <label className="text-sm opacity-70">
                {type.identifier === "symbol"
                  ? t(
                      "Símbolo de Yahoo (obligatorio, ej: BTC-EUR)",
                      "Yahoo symbol (required, e.g. BTC-EUR)",
                    )
                  : t(
                      "Símbolo de Yahoo (ej: CSPX.AS; vacío = buscar por ISIN)",
                      "Yahoo symbol (e.g. CSPX.AS; empty = search by ISIN)",
                    )}
              </label>
              <input
                placeholder={type.identifier === "symbol" ? "BTC-EUR" : "CSPX.AS"}
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                autoCapitalize="characters"
                className={field}
              />
              <SymbolSearch
                query={ticker.trim() || (type.identifier === "isin" ? isin : "")}
                onPick={setTicker}
              />
            </>
          )}

          {source === "ft" && (
            <>
              <p className="text-sm opacity-70">
                {t(
                  "Usa el ISIN de arriba para buscar el valor liquidativo diario.",
                  "It uses the ISIN above to look up the daily net asset value.",
                )}
              </p>
              <SymbolSearch source="ft" query={isin} onPick={() => {}} />
            </>
          )}
        </>
      )}

      {type.has_maturity && (
        <>
          <label className="text-sm opacity-70">
            {t("Fecha de vencimiento (opcional)", "Maturity date (optional)")}
          </label>
          <input
            type="date"
            value={maturity}
            onChange={(e) => setMaturity(e.target.value)}
            className={field}
          />
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Data loading                                                       */
/* ------------------------------------------------------------------ */
type ViewData = {
  types: AssetType[];
  platforms: Item[];
  categories: Item[];
  assets: Asset[];
  error: string;
};

async function fetchViewData(): Promise<ViewData> {
  const [typesRes, platformsRes, categoriesRes, assetsRes] = await Promise.all([
    supabase.from("asset_types").select("*").order("created_at").order("name"),
    supabase.from("platforms").select("*").order("created_at").order("name"),
    supabase.from("categories").select("*").order("created_at").order("name"),
    supabase
      .from("assets")
      .select(
        "*, asset_types(name, base_key, valuation, identifier, has_maturity, annual_return), platforms(name), categories(name)",
      )
      .order("created_at"),
  ]);

  const failure = [typesRes, platformsRes, categoriesRes, assetsRes]
    .map((r) => r.error)
    .find(Boolean);

  return {
    types: ((typesRes.data ?? []) as AssetType[]).sort((a, b) => typeOrder(a) - typeOrder(b)),
    platforms: (platformsRes.data ?? []) as Item[],
    categories: (categoriesRes.data ?? []) as Item[],
    assets: (assetsRes.data ?? []) as unknown as Asset[],
    error: failure ? failure.message : "",
  };
}

/* ------------------------------------------------------------------ */
/* Main screen                                                        */
/* ------------------------------------------------------------------ */
export default function Assets() {
  const [types, setTypes] = useState<AssetType[]>([]);
  const [platforms, setPlatforms] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Item[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // New asset form
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState("");
  const [platformId, setPlatformId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [isin, setIsin] = useState("");
  const [ticker, setTicker] = useState("");
  const [source, setSource] = useState<PriceSource>("yahoo");
  const [maturity, setMaturity] = useState("");

  // Editing an existing asset
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edName, setEdName] = useState("");
  const [edIsin, setEdIsin] = useState("");
  const [edTicker, setEdTicker] = useState("");
  const [edSource, setEdSource] = useState<PriceSource>("yahoo");
  const [edMaturity, setEdMaturity] = useState("");
  const [edReturn, setEdReturn] = useState("");

  // Type form
  const [typeName, setTypeName] = useState("");
  const [valuation, setValuation] = useState<Valuation>("balance");
  const [identifier, setIdentifier] = useState<Identifier>("isin");
  const [hasMaturity, setHasMaturity] = useState(false);
  const [annualReturn, setAnnualReturn] = useState("");

  const chosenType = typeId || types[0]?.id || "";
  const chosenPlatform = platformId || platforms[0]?.id || "";
  const currentType = types.find((tp) => tp.id === chosenType);

  const show = useCallback((d: ViewData) => {
    setError(d.error);
    setTypes(d.types);
    setPlatforms(d.platforms);
    setCategories(d.categories);
    setAssets(d.assets);
    setLoading(false);
  }, []);

  const load = useCallback(async () => {
    show(await fetchViewData());
  }, [show]);

  useEffect(() => {
    fetchViewData().then(show);
  }, [show]);

  /* ---------- Assets ---------- */
  async function addAsset(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const cleanIsin = cleanCode(isin);
    const cleanTicker = cleanCode(ticker);
    const failure = validateFields(currentType, cleanIsin, cleanTicker, source);
    if (failure) {
      setError(failure);
      return;
    }

    setSaving(true);
    const platform = platforms.find((p) => p.id === chosenPlatform);
    const category = categories.find((c) => c.id === categoryId);
    const autoName = `${[currentType && nt(currentType), category?.name]
      .filter(Boolean)
      .join(" ")} · ${platform?.name ?? ""}`;

    const { error } = await supabase.from("assets").insert({
      name: name.trim() || autoName,
      type_id: chosenType,
      platform_id: chosenPlatform,
      category_id: categoryId || null,
      isin: currentType?.identifier === "isin" ? cleanIsin : null,
      ticker:
        currentType?.valuation === "market" && source === "yahoo" ? cleanTicker || null : null,
      price_source: currentType?.valuation === "market" ? source : "manual",
      maturity_date: currentType?.has_maturity ? maturity || null : null,
    });
    if (error) {
      setError(error.message);
    } else {
      setName("");
      setIsin("");
      setTicker("");
      setMaturity("");
      await load();
    }
    setSaving(false);
  }

  function startEditing(a: Asset) {
    setError("");
    setEditingId(a.id);
    setEdName(a.name);
    setEdIsin(a.isin ?? "");
    setEdTicker(a.ticker ?? "");
    setEdSource(a.price_source ?? "yahoo");
    setEdMaturity(a.maturity_date ?? "");
    setEdReturn(a.annual_return === null ? "" : formatPct(a.annual_return));
  }

  async function saveEdit(e: React.FormEvent, a: Asset) {
    e.preventDefault();
    setError("");
    const type = a.asset_types;

    const cleanIsin = cleanCode(edIsin);
    const cleanTicker = cleanCode(edTicker);
    const failure = validateFields(type, cleanIsin, cleanTicker, edSource);
    if (failure) {
      setError(failure);
      return;
    }

    let pct: number | null = null;
    if (edReturn.trim() !== "") {
      pct = parseNumber(edReturn);
      if (pct === null) {
        setError(
          t(
            "La rentabilidad debe ser un número (ej: 3 o 2,75)",
            "The return must be a number (e.g. 3 or 2.75)",
          ),
        );
        return;
      }
    }

    setSaving(true);
    const { error } = await supabase
      .from("assets")
      .update({
        name: edName.trim() || a.name,
        isin: type?.identifier === "isin" ? cleanIsin : null,
        ticker: type?.valuation === "market" && edSource === "yahoo" ? cleanTicker || null : null,
        price_source: type?.valuation === "market" ? edSource : "manual",
        maturity_date: type?.has_maturity ? edMaturity || null : null,
        annual_return: pct,
      })
      .eq("id", a.id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEditingId(null);
    await load();
  }

  async function removeAsset(asset: Asset) {
    const confirmed = confirm(
      t(
        `¿Borrar "${asset.name}" y todas sus operaciones? No se puede deshacer.`,
        `Delete "${asset.name}" and all its activity? This can't be undone.`,
      ),
    );
    if (!confirmed) return;
    setError("");
    const { error } = await supabase.from("assets").delete().eq("id", asset.id);
    if (error) {
      setError(
        error.code === "23503"
          ? t(
              "No se puede borrar: tiene movimientos asociados",
              "Can't delete it: it has linked transactions",
            )
          : error.message,
      );
    } else {
      await load();
    }
  }

  /* ---------- Types ---------- */
  async function addType(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const pct = annualReturn.trim() === "" ? 0 : parseNumber(annualReturn);
    if (pct === null) {
      setError(
        t(
          "La rentabilidad debe ser un número (ej: 3 o 2,75)",
          "The return must be a number (e.g. 3 or 2.75)",
        ),
      );
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("asset_types").insert({
      name: typeName.trim(),
      valuation,
      identifier: valuation === "market" ? identifier : "none",
      has_maturity: valuation === "balance" ? hasMaturity : false,
      annual_return: pct,
    });
    if (error) {
      setError(
        error.code === "23505"
          ? t("Ya existe un tipo con ese nombre", "A type with that name already exists")
          : error.message,
      );
    } else {
      setTypeName("");
      setAnnualReturn("");
      setHasMaturity(false);
      await load();
    }
    setSaving(false);
  }

  async function editTypeReturn(type: AssetType) {
    const text = prompt(
      t(
        `Rentabilidad anual estimada de "${nt(type)}" (en %)`,
        `Estimated yearly return of "${nt(type)}" (in %)`,
      ),
      formatPct(type.annual_return),
    );
    if (text === null) return;
    const pct = parseNumber(text);
    if (pct === null) {
      setError(
        t(
          "La rentabilidad debe ser un número (ej: 3 o 2,75)",
          "The return must be a number (e.g. 3 or 2.75)",
        ),
      );
      return;
    }
    setError("");
    const { error } = await supabase
      .from("asset_types")
      .update({ annual_return: pct })
      .eq("id", type.id);
    if (error) setError(error.message);
    else await load();
  }

  async function removeType(type: AssetType) {
    const confirmed = confirm(
      t(`¿Borrar el tipo "${nt(type)}"?`, `Delete the type "${nt(type)}"?`),
    );
    if (!confirmed) return;
    setError("");
    const { error } = await supabase.from("asset_types").delete().eq("id", type.id);
    if (error) {
      setError(
        error.code === "23503"
          ? t(
              "No se puede borrar: hay activos de este tipo",
              "Can't delete it: there are assets of this type",
            )
          : error.message,
      );
    } else {
      await load();
    }
  }

  if (loading) return <p className="p-4">{t("Cargando...", "Loading...")}</p>;

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-red-500">{error}</p>}

      {/* ---------- ASSETS ---------- */}
      <Collapsible
        title={t("💼 Activos", "💼 Assets")}
        summary={<span className="text-sm opacity-60">{assets.length}</span>}
      >
        <Collapsible nested title={t("Mis activos", "My assets")} open>
          {assets.length === 0 ? (
            <p className="mb-4 opacity-70">
              {t("Todavía no has añadido ningún activo.", "You haven't added any assets yet.")}
            </p>
          ) : (
            <ul className="mb-4 flex flex-col gap-2">
              {assets.map((a) => {
                const type = a.asset_types;
                const missingIsin = type?.identifier === "isin" && !a.isin;
                const missingSymbol =
                  type?.identifier === "symbol" && a.price_source === "yahoo" && !a.ticker;

                return (
                  <li key={a.id} className="rounded border border-gray-400 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{a.name}</p>
                        <p className="text-sm opacity-70">
                          {[type && nt(type), a.categories?.name, a.platforms?.name]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {(a.isin || a.ticker) && (
                          <p className="text-sm opacity-70">
                            {[
                              a.isin && `ISIN ${a.isin}`,
                              a.price_source === "yahoo" && a.ticker && `Yahoo ${a.ticker}`,
                              a.price_source === "ft" &&
                                t("Precio: Financial Times", "Price: Financial Times"),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        {a.maturity_date && (
                          <p className="text-sm opacity-70">
                            {t("Vence el", "Matures on")} {prettyDate(a.maturity_date)}
                          </p>
                        )}
                        <p className="text-sm opacity-70">
                          {t("Rentabilidad anual estimada", "Estimated yearly return")}:{" "}
                          {formatPct(a.annual_return ?? type?.annual_return ?? 0)}
                          {pctSign()}
                          {a.annual_return === null ? ` (${t("la del tipo", "the type's")})` : ""}
                        </p>
                        {(missingIsin || missingSymbol) && (
                          <p className="text-sm font-semibold text-orange-500">
                            {missingIsin
                              ? t(
                                  "⚠️ Falta el ISIN: pulsa Editar",
                                  "⚠️ The ISIN is missing: press Edit",
                                )
                              : t(
                                  "⚠️ Falta el símbolo: pulsa Editar",
                                  "⚠️ The symbol is missing: press Edit",
                                )}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <button onClick={() => startEditing(a)} className="text-sm underline">
                          {t("Editar", "Edit")}
                        </button>
                        <button
                          onClick={() => removeAsset(a)}
                          className="text-sm text-red-500 underline"
                        >
                          {t("Borrar", "Delete")}
                        </button>
                      </div>
                    </div>

                    {editingId === a.id && (
                      <form onSubmit={(e) => saveEdit(e, a)} className="mt-3 flex flex-col gap-3">
                        <label className="text-sm opacity-70">{t("Nombre", "Name")}</label>
                        <input
                          value={edName}
                          onChange={(e) => setEdName(e.target.value)}
                          className={field}
                        />
                        <TypeFields
                          type={type}
                          isin={edIsin}
                          setIsin={setEdIsin}
                          ticker={edTicker}
                          setTicker={setEdTicker}
                          source={edSource}
                          setSource={setEdSource}
                          maturity={edMaturity}
                          setMaturity={setEdMaturity}
                        />
                        <label className="text-sm opacity-70">
                          {t(
                            "Rentabilidad anual estimada % (vacío = la del tipo,",
                            "Estimated yearly return % (empty = the type's,",
                          )}{" "}
                          {formatPct(type?.annual_return ?? 0)}
                          {pctSign()})
                        </label>
                        <input
                          value={edReturn}
                          onChange={(e) => setEdReturn(e.target.value)}
                          inputMode="decimal"
                          className={field}
                        />
                        <div className="flex gap-2">
                          <button type="submit" disabled={saving} className={`${button} flex-1`}>
                            {saving ? t("Guardando...", "Saving...") : t("Guardar", "Save")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="flex-1 rounded border border-gray-400 p-3 text-base"
                          >
                            {t("Cancelar", "Cancel")}
                          </button>
                        </div>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Collapsible>
        <Collapsible nested title={t("➕ Añadir activo", "➕ Add asset")}>
          {platforms.length === 0 && (
            <p className="mb-2 opacity-70">
              {t(
                "Antes de añadir un activo, crea al menos una plataforma en «Plataformas».",
                "Before adding an asset, create at least one platform in «Platforms».",
              )}
            </p>
          )}
          <form onSubmit={addAsset} className="flex flex-col gap-3">
            <label className="text-sm opacity-70">{t("Tipo", "Type")}</label>
            <select
              value={chosenType}
              onChange={(e) => setTypeId(e.target.value)}
              className={field}
            >
              {types.map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {nt(tp)}
                </option>
              ))}
            </select>

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

            <label className="text-sm opacity-70">
              {t("Categoría (opcional)", "Category (optional)")}
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={field}
            >
              <option value="">{t("Sin categoría", "No category")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <TypeFields
              type={currentType}
              isin={isin}
              setIsin={setIsin}
              ticker={ticker}
              setTicker={setTicker}
              source={source}
              setSource={setSource}
              maturity={maturity}
              setMaturity={setMaturity}
            />

            <label className="text-sm opacity-70">
              {t("Nombre (opcional)", "Name (optional)")}
            </label>
            <input
              placeholder={t("Ej: iShares Core S&P 500", "e.g. iShares Core S&P 500")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={field}
            />

            <button
              type="submit"
              disabled={saving || !chosenType || !chosenPlatform}
              className={button}
            >
              {saving ? t("Guardando...", "Saving...") : t("Añadir activo", "Add asset")}
            </button>
          </form>
        </Collapsible>
      </Collapsible>

      {/* ---------- PLATFORMS ---------- */}
      <SimpleList
        title={t("🏢 Plataformas", "🏢 Platforms")}
        table="platforms"
        items={platforms}
        example="MyInvestor"
        onChange={load}
        onError={setError}
      />

      {/* ---------- CATEGORIES ---------- */}
      <SimpleList
        title={t("🏷️ Categorías de activo", "🏷️ Asset categories")}
        table="categories"
        items={categories}
        example="Nasdaq"
        onChange={load}
        onError={setError}
      />

      {/* ---------- TYPES ---------- */}
      <Collapsible
        title={t("🧩 Tipos de activo", "🧩 Asset types")}
        summary={<span className="text-sm opacity-60">{types.length}</span>}
      >
        <Collapsible nested title={t("Mis tipos", "My types")} open>
          <ul className="mb-4 flex flex-col gap-2">
            {types.map((tp) => (
              <li
                key={tp.id}
                className="flex items-center justify-between gap-3 rounded border border-gray-400 p-3"
              >
                <div>
                  <p className="font-semibold">
                    {nt(tp)}
                    {tp.base_key && (
                      <span className="ml-2 text-xs font-normal opacity-60">
                        {t("tipo base", "base type")}
                      </span>
                    )}
                  </p>
                  <p className="text-sm opacity-70">
                    {tp.valuation === "market"
                      ? t("Cotiza (precio de mercado)", "Listed (market price)")
                      : t("Saldo", "Balance")}
                    {" · "}
                    {identifierText(tp.identifier)}
                    {tp.has_maturity ? ` · ${t("Con vencimiento", "With maturity")}` : ""}
                  </p>
                  <p className="text-sm opacity-70">
                    {t("Rentabilidad anual estimada", "Estimated yearly return")}:{" "}
                    {formatPct(tp.annual_return)}
                    {pctSign()}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <button onClick={() => editTypeReturn(tp)} className="text-sm underline">
                    {t("Editar %", "Edit %")}
                  </button>
                  {/* Base types can't be deleted: the app would create them again */}
                  {!tp.base_key && (
                    <button
                      onClick={() => removeType(tp)}
                      className="text-sm text-red-500 underline"
                    >
                      {t("Borrar", "Delete")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Collapsible>
        <Collapsible nested title={t("➕ Añadir tipo", "➕ Add type")}>
          <form onSubmit={addType} className="flex flex-col gap-3">
            <input
              placeholder={t("Nombre (ej: Plan de pensiones)", "Name (e.g. Pension plan)")}
              value={typeName}
              onChange={(e) => setTypeName(e.target.value)}
              required
              className={field}
            />
            <select
              value={valuation}
              onChange={(e) => setValuation(e.target.value as Valuation)}
              className={field}
            >
              <option value="balance">
                {t("Saldo (cuenta, depósito, letras...)", "Balance (account, deposit, T-bills...)")}
              </option>
              <option value="market">
                {t(
                  "Cotiza (ETF, fondo, acciones, crypto...)",
                  "Listed (ETF, fund, stocks, crypto...)",
                )}
              </option>
            </select>

            {valuation === "market" ? (
              <select
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value as Identifier)}
                className={field}
              >
                <option value="isin">
                  {t("Pide ISIN (ETF, fondos, acciones)", "Needs ISIN (ETFs, funds, stocks)")}
                </option>
                <option value="symbol">
                  {t("Pide símbolo (crypto)", "Needs symbol (crypto)")}
                </option>
              </select>
            ) : (
              <label className="flex items-center gap-3 py-1">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={hasMaturity}
                  onChange={(e) => setHasMaturity(e.target.checked)}
                />
                {t(
                  "Tiene fecha de vencimiento (depósitos, letras...)",
                  "Has a maturity date (deposits, T-bills...)",
                )}
              </label>
            )}

            <input
              placeholder={t(
                "Rentabilidad anual estimada % (ej: 3)",
                "Estimated yearly return % (e.g. 3)",
              )}
              value={annualReturn}
              onChange={(e) => setAnnualReturn(e.target.value)}
              inputMode="decimal"
              className={field}
            />
            <button type="submit" disabled={saving} className={button}>
              {saving ? t("Guardando...", "Saving...") : t("Añadir tipo", "Add type")}
            </button>
          </form>
        </Collapsible>
      </Collapsible>
    </div>
  );
}
