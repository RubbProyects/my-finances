"use client";

import { useCallback, useEffect, useState } from "react";
import BankInbox from "@/components/BankInbox";
import Collapsible from "@/components/Collapsible";
import MovementForm from "@/components/MovementForm";
import MovementHistory from "@/components/MovementHistory";
import { t } from "@/lib/language";
import { supabase } from "@/lib/supabase";

type SelectOption = { id: string; name: string };

type ViewData = {
  accounts: SelectOption[];
  categories: SelectOption[];
  error: string;
};

// Fetches the accounts and the expense categories
async function fetchViewData(): Promise<ViewData> {
  const [accountsRes, categoriesRes] = await Promise.all([
    supabase
      .from("assets")
      .select("id, name, asset_types!inner(valuation)")
      .eq("asset_types.valuation", "balance")
      .order("created_at"),
    supabase.from("expense_categories").select("id, name").order("name"),
  ]);

  const failure = accountsRes.error || categoriesRes.error;
  return {
    accounts: (accountsRes.data ?? []) as unknown as SelectOption[],
    categories: (categoriesRes.data ?? []) as SelectOption[],
    error: failure ? failure.message : "",
  };
}

export default function Movements() {
  const [accounts, setAccounts] = useState<SelectOption[]>([]);
  const [categories, setCategories] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0); // tells the history there is a new transaction

  const show = useCallback((d: ViewData) => {
    setError(d.error);
    setAccounts(d.accounts);
    setCategories(d.categories);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchViewData().then(show);
  }, [show]);

  if (loading) return <p>{t("Cargando...", "Loading...")}</p>;

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-red-500">{error}</p>}

      {/* ---------- Transactions coming from the bank ---------- */}
      <BankInbox
        accounts={accounts}
        categories={categories}
        onChange={() => setVersion((v) => v + 1)}
      />

      {/* ---------- Form ---------- */}
      <Collapsible title={t("➕ Nuevo movimiento", "➕ New transaction")} open>
        <MovementForm
          accounts={accounts}
          categories={categories}
          onSave={() => setVersion((v) => v + 1)}
        />
      </Collapsible>

      {/* ---------- History with filters ---------- */}
      <MovementHistory accounts={accounts} categories={categories} version={version} />
    </div>
  );
}
