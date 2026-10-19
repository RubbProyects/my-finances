"use client";

import { useCallback, useEffect, useState } from "react";
import Collapsible from "@/components/Collapsible";
import { button, field } from "@/lib/format";
import { t } from "@/lib/language";
import { supabase } from "@/lib/supabase";

type Category = { id: string; name: string };

async function fetchCategories() {
  return supabase.from("expense_categories").select("id, name").order("name");
}

export default function ExpenseCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const show = useCallback((r: Awaited<ReturnType<typeof fetchCategories>>) => {
    if (r.error) setError(r.error.message);
    else setCategories(r.data as Category[]);
  }, []);

  useEffect(() => {
    fetchCategories().then(show);
  }, [show]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const { error } = await supabase.from("expense_categories").insert({ name: name.trim() });
    setSaving(false);
    if (error) {
      setError(
        error.code === "23505"
          ? t("Ya existe una con ese nombre", "One with that name already exists")
          : error.message,
      );
      return;
    }
    setName("");
    fetchCategories().then(show);
  }

  async function remove(c: Category) {
    if (!confirm(t(`¿Borrar "${c.name}"?`, `Delete "${c.name}"?`))) return;
    setError("");
    const { error } = await supabase.from("expense_categories").delete().eq("id", c.id);
    if (error) {
      setError(
        error.code === "23503"
          ? t(
              "No se puede borrar: hay movimientos que la usan",
              "Can't delete it: some transactions use it",
            )
          : error.message,
      );
      return;
    }
    fetchCategories().then(show);
  }

  return (
    <Collapsible
      title={t("🛒 Categorías de gasto", "🛒 Spending categories")}
      summary={<span className="text-sm opacity-60">{categories.length}</span>}
    >
      {error && <p className="mb-3 text-red-500">{error}</p>}

      {categories.length === 0 ? (
        <p className="mb-4 opacity-70">{t("Todavía no hay ninguna.", "None yet.")}</p>
      ) : (
        <ul className="mb-4 flex flex-col gap-2">
          {categories.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded border border-gray-400 p-3"
            >
              <p className="font-semibold">{c.name}</p>
              <button onClick={() => remove(c)} className="text-sm text-red-500 underline">
                {t("Borrar", "Delete")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-col gap-3">
        <input
          placeholder={t("Añadir (ej: Comida)", "Add (e.g. Food)")}
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
