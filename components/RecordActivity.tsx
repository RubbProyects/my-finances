"use client";

import { useState } from "react";
import { fetchAccounts } from "@/components/Accounts";
import ActivityForm from "@/components/ActivityForm";
import { callApi } from "@/lib/api";
import type { FeeSchedule } from "@/lib/fees";
import { t } from "@/lib/language";
import { findOrCreateAsset, isEuroListing, type Listing } from "@/lib/market-assets";
import { fetchPortfolio, type MarketAsset } from "@/lib/portfolio";
import { supabase } from "@/lib/supabase";

type Option = { id: string; name: string };
type Prepared = { assetId: string; assets: MarketAsset[]; accounts: Option[]; fees: FeeSchedule[] };

// "Record a purchase" from the Markets screen: the asset is created by itself if it is new,
// so you don't have to create it in Settings first
export default function RecordActivity({ listing }: { listing: Listing }) {
  const [step, setStep] = useState<"closed" | "choose" | "working" | "form" | "done">("closed");
  const [platforms, setPlatforms] = useState<Option[]>([]);
  const [platformId, setPlatformId] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState("");

  if (!isEuroListing(listing.currency)) {
    return (
      <p className="card p-4 text-sm text-muted">
        {t(
          `Este mercado cotiza en ${listing.currency ?? "otra moneda"} y la app solo lleva euros. Busca el mismo activo en otro mercado que cotice en EUR (por ejemplo Xetra, Ámsterdam o Milán) para apuntar tus operaciones.`,
          `This market quotes in ${listing.currency ?? "another currency"} and the app only handles euros. Search the same asset on another market that quotes in EUR (for example Xetra, Amsterdam or Milan) to record your activity.`,
        )}
      </p>
    );
  }

  async function open() {
    setError("");
    const { data } = await supabase.from("platforms").select("id, name").order("name");
    setPlatforms((data ?? []) as Option[]);
    setStep("choose");
  }

  async function prepare() {
    setError("");
    setStep("working");
    const found = await findOrCreateAsset(listing, platformId || null);
    if ("error" in found) {
      setError(found.error);
      setStep("choose");
      return;
    }
    // A new asset has no price history yet: it is downloaded now so the portfolio can value it
    try {
      await callApi("/api/prices", "POST");
    } catch {
      // The hourly refresh will try again; the purchase can be recorded anyway
    }
    const [portfolio, accounts, fees] = await Promise.all([
      fetchPortfolio(),
      fetchAccounts(),
      supabase.from("fee_schedules").select("*"),
    ]);
    setPrepared({
      assetId: found.id,
      assets: portfolio.assets,
      accounts: accounts.accounts.map((a) => ({ id: a.id, name: a.name })),
      fees: (fees.data ?? []) as FeeSchedule[],
    });
    setStep("form");
  }

  if (step === "done") {
    return (
      <p className="card p-4 text-sm">
        {t(
          "✅ Operación apuntada. La verás en Cartera y en el Resumen.",
          "✅ Activity recorded. You will see it in Portfolio and in the Summary.",
        )}
      </p>
    );
  }

  if (step === "form" && prepared) {
    return (
      <section className="card flex flex-col gap-3 p-4">
        <h3 className="font-semibold">{t("Apuntar operación", "Record activity")}</h3>
        <ActivityForm
          assets={prepared.assets}
          accounts={prepared.accounts}
          feeSchedules={prepared.fees}
          initialAssetId={prepared.assetId}
          onSave={() => setStep("done")}
          onCancel={() => setStep("closed")}
        />
      </section>
    );
  }

  if (step === "closed") {
    return (
      <button type="button" onClick={open} className="card p-4 text-left font-semibold text-accent">
        ➕ {t("Apuntar una operación de este activo", "Record an activity for this asset")}
      </button>
    );
  }

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h3 className="font-semibold">{t("Apuntar operación", "Record activity")}</h3>
      <p className="text-sm text-muted">
        {t(
          "Si no lo tienes todavía, se añade solo a tu cartera. Elige la plataforma donde lo compras (sirve para calcular la comisión).",
          "If you don't have it yet, it is added to your portfolio by itself. Choose the platform where you buy it (used to calculate the fee).",
        )}
      </p>
      <label className="flex flex-col gap-1 text-sm">
        {t("Plataforma", "Platform")}
        <select
          value={platformId}
          onChange={(e) => setPlatformId(e.target.value)}
          className="rounded-lg border border-line bg-surface p-2 text-base"
          disabled={step === "working"}
        >
          <option value="">{t("— ninguna —", "— none —")}</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-sm text-down">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="chip card" onClick={prepare} disabled={step === "working"}>
          {step === "working" ? t("Preparando...", "Preparing...") : t("Continuar", "Continue")}
        </button>
        <button type="button" className="chip card" onClick={() => setStep("closed")} disabled={step === "working"}>
          {t("Cancelar", "Cancel")}
        </button>
      </div>
    </section>
  );
}
