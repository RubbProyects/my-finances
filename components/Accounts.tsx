"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { parseNumber, button, field, roundCents, euros, today } from "@/lib/format";
import { t } from "@/lib/language";

export type Account = {
  id: string;
  name: string;
  platform: string | null;
  balance: number;
};

type AssetRow = {
  id: string;
  name: string;
  platforms: { name: string } | null;
};

// Fetches the accounts (assets of type "balance") and their balances from the database
export async function fetchAccounts(): Promise<{ accounts: Account[]; error: string }> {
  const [assetsRes, balancesRes] = await Promise.all([
    supabase
      .from("assets")
      .select("id, name, platforms(name), asset_types!inner(valuation)")
      .eq("asset_types.valuation", "balance")
      .order("created_at"),
    supabase.from("account_balances").select("account_id, balance"),
  ]);

  const failure = assetsRes.error || balancesRes.error;
  if (failure) return { accounts: [], error: failure.message };

  const balanceByAccount = new Map<string, number>(
    (balancesRes.data ?? []).map((s) => [s.account_id, Number(s.balance ?? 0)]),
  );
  const rows = (assetsRes.data ?? []) as unknown as AssetRow[];
  const accounts = rows.map((a) => ({
    id: a.id,
    name: a.name,
    platform: a.platforms?.name ?? null,
    balance: balanceByAccount.get(a.id) ?? 0,
  }));
  return { accounts, error: "" };
}

// List of accounts with their balance and the "Adjust balance" button
export default function Accounts({
  accounts,
  onChange,
}: {
  accounts: Account[];
  onChange: () => void;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [actualBalance, setActualBalance] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveAdjustment(e: React.FormEvent, account: Account) {
    e.preventDefault();
    setError("");
    setNotice("");

    const actualNum = parseNumber(actualBalance);
    if (actualNum === null) {
      setError(t("Escribe un número, por ejemplo 1234,56", "Enter a number, e.g. 1234.56"));
      return;
    }

    const difference = roundCents(actualNum - account.balance);
    if (difference === 0) {
      setNotice(
        t(
          "El saldo ya era ese: no se ha guardado nada.",
          "The balance was already that: nothing saved.",
        ),
      );
      setEditing(null);
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("movements").insert({
      date: today(),
      type: "adjustment",
      amount: difference,
      account_id: account.id,
      description: t("Ajuste de saldo", "Balance adjustment"),
    });
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setNotice(
      `${t("Ajuste guardado en", "Adjustment saved in")} ${account.name}: ${difference > 0 ? "+" : ""}${euros(difference)}`,
    );
    setEditing(null);
    setActualBalance("");
    onChange();
  }

  if (accounts.length === 0) {
    return (
      <p className="text-sm opacity-70">
        {t(
          "Todavía no tienes cuentas. Ve a Ajustes y crea un activo de tipo Banco (o de otro tipo con valoración «saldo»).",
          "No accounts yet. Go to Settings and create an asset of type Bank (or another type valued by «balance»).",
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-red-500">{error}</p>}
      {notice && <p className="text-green-600">{notice}</p>}

      <ul className="flex flex-col gap-2">
        {accounts.map((c) => (
          <li key={c.id} className="rounded border border-gray-400/50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{c.name}</p>
                {c.platform && <p className="text-sm opacity-70">{c.platform}</p>}
              </div>
              <p className={`font-bold ${c.balance < 0 ? "text-red-500" : ""}`}>
                {euros(c.balance)}
              </p>
            </div>

            {editing === c.id ? (
              <form onSubmit={(e) => saveAdjustment(e, c)} className="mt-3 flex flex-col gap-2">
                <label className="text-sm opacity-70">
                  {t("Saldo real que tienes hoy en", "Your real balance today in")} {c.name}
                </label>
                <input
                  className={field}
                  inputMode="decimal"
                  placeholder={t("Por ejemplo 1234,56", "e.g. 1234.56")}
                  value={actualBalance}
                  onChange={(e) => setActualBalance(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button type="submit" className={`${button} flex-1`} disabled={saving}>
                    {saving ? t("Guardando...", "Saving...") : t("Guardar", "Save")}
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded border border-gray-400 p-3 text-base"
                    onClick={() => setEditing(null)}
                  >
                    {t("Cancelar", "Cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <button
                className="mt-1 text-sm underline"
                onClick={() => {
                  setError("");
                  setNotice("");
                  setActualBalance("");
                  setEditing(c.id);
                }}
              >
                {t("Ajustar saldo", "Adjust balance")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
