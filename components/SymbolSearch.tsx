"use client";

import { useState } from "react";
import { callApi } from "@/lib/api";
import { price as fmtPrice } from "@/lib/format";
import { language, t } from "@/lib/language";
import { translateMessage } from "@/lib/messages";

type SelectOption = {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  currency: string | null;
  price: number | null;
};

// Button that searches Yahoo for the symbols of an ISIN (or a text) and lets you pick one
export default function SymbolSearch({
  query,
  onPick,
  source = "yahoo",
}: {
  query: string;
  onPick: (symbol: string) => void;
  source?: "yahoo" | "ft";
}) {
  const [options, setOptions] = useState<SelectOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    setError("");
    setOptions(null);
    const q = query.trim();
    if (q.length < 2) {
      setError(
        source === "ft"
          ? t("Escribe primero el ISIN del fondo", "Enter the fund's ISIN first")
          : t(
              "Escribe primero el ISIN (o el nombre, en crypto)",
              "Enter the ISIN first (or the name, for crypto)",
            ),
      );
      return;
    }
    setSearching(true);
    try {
      const r = await callApi<{ options: SelectOption[] }>(
        `/api/symbols?q=${encodeURIComponent(q)}&source=${source}`,
      );
      setOptions(r.options);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSearching(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={search}
        disabled={searching}
        className="self-start text-sm underline disabled:opacity-50"
      >
        {searching
          ? t("Buscando...", "Searching...")
          : source === "ft"
            ? t("🔎 Comprobar en Financial Times", "🔎 Check on Financial Times")
            : t("🔎 Buscar símbolo en Yahoo", "🔎 Search symbol on Yahoo")}
      </button>

      {error && <p className="text-sm text-down">{error}</p>}

      {options && options.length === 0 && (
        <p className="text-sm opacity-70">
          {t(
            "No se ha encontrado ninguno: este activo irá con precio manual.",
            "None found: this asset will use a manual price.",
          )}
        </p>
      )}

      {options && options.length > 0 && (
        <ul className="flex flex-col gap-1">
          {options.map((o) => (
            <li key={o.symbol}>
              <button
                type="button"
                onClick={() => {
                  onPick(o.symbol);
                  setOptions(null);
                }}
                className="w-full rounded-xl border border-line bg-surface p-2 text-left text-sm"
              >
                <span className="font-semibold">{o.symbol}</span>
                {o.currency && (
                  <span className={o.currency === "EUR" ? "text-up" : "text-orange-500"}>
                    {" "}
                    · {o.currency}
                  </span>
                )}
                {o.price !== null && ` · ${fmtPrice(o.price)}`}
                <br />
                <span className="opacity-70">
                  {translateMessage(
                    [o.name, o.exchange, o.type].filter(Boolean).join(" · "),
                    language(),
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {options && options.length > 0 && (
        <p className="text-xs opacity-70">
          {t(
            "Elige uno en EUR (en verde). El precio sirve para comprobar que es el producto correcto.",
            "Choose one in EUR (in green). The price helps you check it's the right product.",
          )}
        </p>
      )}
    </div>
  );
}
