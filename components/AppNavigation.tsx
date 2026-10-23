"use client";

import { useEffect, useState } from "react";
import Assets from "@/components/Assets";
import Analysis from "@/components/Analysis";
import CaptureSettings from "@/components/CaptureSettings";
import Banks, { type BankNotice } from "@/components/Banks";
import ExpenseCategories from "@/components/ExpenseCategories";
import LanguagePicker from "@/components/LanguagePicker";
import Investments from "@/components/Investments";
import Markets from "@/components/Markets";
import MyAccount from "@/components/MyAccount";
import Movements from "@/components/Movements";
import HideMoney from "@/components/HideMoney";
import Summary from "@/components/Summary";
import FeeSchedules from "@/components/FeeSchedules";
import { refreshIfStale } from "@/lib/auto-prices";
import { language, t } from "@/lib/language";
import { translateMessage } from "@/lib/messages";
import { supabase } from "@/lib/supabase";
import { baseTypeRows } from "@/lib/asset-types";

type Tab = "summary" | "markets" | "investments" | "movements" | "analysis" | "settings";

// A function (not a fixed list) so the texts come out in the chosen language
const tabs = (): { id: Tab; text: string }[] => [
  { id: "summary", text: t("Resumen", "Summary") },
  { id: "markets", text: t("Mercados", "Markets") },
  { id: "investments", text: t("Cartera", "Portfolio") },
  { id: "movements", text: t("Movimientos", "Transactions") },
  { id: "analysis", text: t("Análisis", "Analysis") },
  { id: "settings", text: t("Ajustes", "Settings") },
];

// Line icons (24x24), drawn with the current text color
const ICONS: Record<Tab, string> = {
  summary: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  markets: "M3 3v18h18M7 15l4-4 3 3 5-6",
  investments: "M4 7h16v13H4zM9 7V4h6v3M4 13h16",
  movements: "M7 4v16M7 20l-4-4M7 20l4-4M17 20V4M17 4l-4 4M17 4l4 4",
  analysis: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  settings:
    "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
};

// When coming back from the bank's website, the address has ?bank=ok or ?bank=error&reason=...
function readBankNotice(): BankNotice | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const result = q.get("bank");
  if (!result) return null;
  return result === "ok"
    ? {
        ok: true,
        text: t(
          "✅ Banco conectado. Elige a qué cuenta de la app corresponde cada una.",
          "✅ Bank connected. Choose which app account each one belongs to.",
        ),
      }
    : {
        ok: false,
        text: `${t("⚠️ No se ha podido conectar", "⚠️ Could not connect")}: ${
          translateMessage(q.get("reason") ?? "", language()) ||
          t("error desconocido", "unknown error")
        }`,
      };
}

// Creates the base asset types this user is missing (the first time, all of them).
// If one clashes with a type they already have with that name, it's skipped silently.
// Runs only once per app load (even if React mounts the screen twice).
let baseTypesEnsured: Promise<void> | null = null;
function ensureBaseTypes() {
  baseTypesEnsured ??= createMissingTypes();
  return baseTypesEnsured;
}

async function createMissingTypes() {
  const { data, error } = await supabase.from("asset_types").select("base_key");
  if (error) return;
  const missing = baseTypeRows(
    ((data ?? []) as { base_key: string | null }[]).map((d) => d.base_key),
  );
  for (const row of missing) await supabase.from("asset_types").insert(row);
}

export default function AppNavigation() {
  const [bankNotice] = useState(readBankNotice);
  const [current, setCurrent] = useState<Tab>(bankNotice ? "settings" : "summary");

  useEffect(() => {
    ensureBaseTypes();
  }, []);

  // Prices refresh by themselves when the app opens (if they are old) and then every hour
  const [pricesVersion, setPricesVersion] = useState(0);
  useEffect(() => {
    const run = () => {
      if (document.visibilityState === "visible") {
        refreshIfStale().then((updated) => updated && setPricesVersion((v) => v + 1));
      }
    };
    run();
    const timer = setInterval(run, 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // Removes ?bank=... from the address so it doesn't show up again on reload
  useEffect(() => {
    if (bankNotice) window.history.replaceState(null, "", window.location.pathname);
  }, [bankNotice]);
  const list = tabs();
  const title = list.find((p) => p.id === current)?.text;

  return (
    <div className="pb-28">
      <section className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-5">
        <div className="flex items-center justify-between gap-3 px-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <HideMoney />
        </div>

        {current === "summary" && <Summary key={pricesVersion} />}
        {current === "markets" && <Markets />}
        {current === "investments" && <Investments key={pricesVersion} />}
        {current === "movements" && <Movements />}
        {current === "analysis" && <Analysis />}
        {current === "settings" && (
          <>
            <Assets />
            <ExpenseCategories />
            <FeeSchedules />
            <Banks notice={bankNotice} />
            <CaptureSettings />
            <LanguagePicker />
            <MyAccount />
          </>
        )}
      </section>

      <nav
        className="fixed inset-x-0 bottom-0 flex justify-center px-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
      >
        <div className="card flex w-full max-w-md gap-1 p-1.5 backdrop-blur">
          {list.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setCurrent(p.id);
                window.scrollTo({ top: 0 });
              }}
              aria-current={current === p.id ? "page" : undefined}
              className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px] font-medium transition-colors ${
                current === p.id ? "bg-accent/15 text-accent" : "text-muted"
              }`}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d={ICONS[p.id]} />
              </svg>
              {p.text}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
