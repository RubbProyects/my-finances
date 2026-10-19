"use client";

import { useEffect, useState } from "react";
import Assets from "@/components/Assets";
import Analysis from "@/components/Analysis";
import Banks, { type BankNotice } from "@/components/Banks";
import ExpenseCategories from "@/components/ExpenseCategories";
import LanguagePicker from "@/components/LanguagePicker";
import Investments from "@/components/Investments";
import MyAccount from "@/components/MyAccount";
import Movements from "@/components/Movements";
import HideMoney from "@/components/HideMoney";
import Summary from "@/components/Summary";
import FeeSchedules from "@/components/FeeSchedules";
import { language, t } from "@/lib/language";
import { translateMessage } from "@/lib/messages";
import { supabase } from "@/lib/supabase";
import { baseTypeRows } from "@/lib/asset-types";

type Tab = "summary" | "investments" | "movements" | "analysis" | "settings";

// A function (not a fixed list) so the texts come out in the chosen language
const tabs = (): { id: Tab; icon: string; text: string }[] => [
  { id: "summary", icon: "📊", text: t("Resumen", "Summary") },
  { id: "investments", icon: "📈", text: t("Inversiones", "Investments") },
  { id: "movements", icon: "💸", text: t("Movimientos", "Transactions") },
  { id: "analysis", icon: "🔍", text: t("Análisis", "Analysis") },
  { id: "settings", icon: "⚙️", text: t("Ajustes", "Settings") },
];

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

  // Removes ?bank=... from the address so it doesn't show up again on reload
  useEffect(() => {
    if (bankNotice) window.history.replaceState(null, "", window.location.pathname);
  }, [bankNotice]);
  const list = tabs();
  const title = list.find((p) => p.id === current)?.text;

  return (
    <div className="pb-24">
      <section className="mx-auto flex max-w-md flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{title}</h1>
          <HideMoney />
        </div>

        {current === "summary" && <Summary />}
        {current === "investments" && <Investments />}
        {current === "movements" && <Movements />}
        {current === "analysis" && <Analysis />}
        {current === "settings" && (
          <>
            <Assets />
            <ExpenseCategories />
            <FeeSchedules />
            <Banks notice={bankNotice} />
            <LanguagePicker />
            <MyAccount />
          </>
        )}
      </section>

      <nav
        className="fixed bottom-0 left-0 right-0 flex border-t border-gray-400"
        style={{
          backgroundColor: "var(--background, white)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {list.map((p) => (
          <button
            key={p.id}
            onClick={() => setCurrent(p.id)}
            aria-current={current === p.id ? "page" : undefined}
            className={`flex flex-1 flex-col items-center py-2 text-xs ${
              current === p.id ? "font-bold text-blue-600" : "opacity-70"
            }`}
          >
            <span className="text-xl">{p.icon}</span>
            {p.text}
          </button>
        ))}
      </nav>
    </div>
  );
}
