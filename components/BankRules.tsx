"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAccounts, type Account } from "@/components/Accounts";
import Collapsible from "@/components/Collapsible";
import { normalize, type Rule } from "@/lib/classify";
import { t } from "@/lib/language";
import { supabase } from "@/lib/supabase";

type Category = { id: string; name: string };
type Data = { rules: Rule[]; categories: Category[]; accounts: Account[]; error: string };

async function fetchData(): Promise<Data> {
  const [rules, categories, accounts] = await Promise.all([
    supabase.from("bank_rules").select("*").order("text"),
    supabase.from("expense_categories").select("id, name").order("name"),
    fetchAccounts(),
  ]);
  const failure = rules.error || categories.error;
  return {
    rules: (rules.data ?? []) as Rule[],
    categories: (categories.data ?? []) as Category[],
    accounts: accounts.accounts,
    error: failure ? failure.message : accounts.error,
  };
}

// Settings → Bank rules: see, edit and delete the rules that record bank transactions by themselves
export default function BankRules() {
  const [data, setData] = useState<Data | null>(null);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [bizum, setBizum] = useState(false);
  const [message, setMessage] = useState("");

  const show = useCallback((d: Data) => setData(d), []);
  const reload = useCallback(() => {
    fetchData().then(show);
  }, [show]);
  useEffect(() => {
    fetchData().then(show);
  }, [show]);

  function startEditing(r: Rule) {
    setEditing(r.id);
    setDescription(r.description ?? "");
    setCategoryId(r.category_id ?? "");
    setBizum(r.bizum);
    setMessage("");
  }

  async function save(r: Rule) {
    const { error } = await supabase
      .from("bank_rules")
      .update({
        description: description.trim() || null,
        category_id: categoryId || null,
        bizum,
      })
      .eq("id", r.id);
    if (error) return setMessage(error.message);
    setEditing(null);
    reload();
  }

  async function remove(r: Rule) {
    const question = t(
      `¿Borrar la regla «${r.text}»? Los movimientos que ya apuntó se quedan como están; los próximos del banco ya no se apuntarán solos con ella.`,
      `Delete the rule «${r.text}»? What it already recorded stays as it is; future bank transactions won't be recorded by it any more.`,
    );
    if (!confirm(question)) return;
    const { error } = await supabase.from("bank_rules").delete().eq("id", r.id);
    if (error) return setMessage(error.message);
    setMessage(t(`Regla «${r.text}» borrada`, `Rule «${r.text}» deleted`));
    reload();
  }

  const nameOf = (list: { id: string; name: string }[], id: string | null) =>
    list.find((x) => x.id === id)?.name ?? t("sin categoría", "no category");
  const needle = normalize(filter);
  const rules = (data?.rules ?? []).filter(
    (r) => !needle || r.text.includes(needle) || normalize(r.description ?? "").includes(needle),
  );

  return (
    <Collapsible
      title={t("📏 Reglas del banco", "📏 Bank rules")}
      summary={<span className="text-sm text-muted">{data ? data.rules.length : ""}</span>}
    >
      <p className="text-sm text-muted">
        {t(
          "Cada regla apunta sola los movimientos del banco cuyo texto contiene su palabra. Aquí puedes cambiar el nombre y la categoría que ponen, o borrarla.",
          "Each rule records by itself the bank transactions whose text contains its word. Here you can change the name and category it sets, or delete it.",
        )}
      </p>
      {data?.error && <p className="text-sm text-down">{data.error}</p>}
      {message && <p className="text-sm">{message}</p>}

      {(data?.rules.length ?? 0) > 6 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("Buscar regla", "Search rule")}
          aria-label={t("Buscar regla", "Search rule")}
          className="rounded-lg border border-line bg-surface p-2 text-base"
        />
      )}

      {data && data.rules.length === 0 ? (
        <p className="text-sm text-muted">
          {t(
            "Todavía no hay reglas: se crean al clasificar un movimiento y marcar «recordar».",
            "No rules yet: they are created when you classify a transaction and tick «remember».",
          )}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {rules.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">«{r.text}»</p>
                  <p className="text-sm text-muted">
                    {r.is_transfer
                      ? `${t("Transferencia con", "Transfer with")} ${nameOf(data?.accounts ?? [], r.other_account_id)}`
                      : `${nameOf(data?.categories ?? [], r.category_id)}${r.bizum ? " · Bizum" : ""}`}
                    {r.description ? ` · ${t("nombre", "name")}: ${r.description}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-3 text-sm">
                  {!r.is_transfer && (
                    <button type="button" className="text-blue-600 underline" onClick={() => startEditing(r)}>
                      {t("Editar", "Edit")}
                    </button>
                  )}
                  <button type="button" className="text-red-500 underline" onClick={() => remove(r)}>
                    {t("Borrar", "Delete")}
                  </button>
                </div>
              </div>

              {editing === r.id && (
                <form
                  className="mt-3 flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save(r);
                  }}
                >
                  <label className="flex flex-col gap-1 text-sm">
                    {t("Nombre que pone al apuntar (vacío = el del banco)", "Name it sets when recording (empty = the bank's)")}
                    <input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="rounded-lg border border-line bg-surface p-2 text-base"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    {t("Categoría", "Category")}
                    <select
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="rounded-lg border border-line bg-surface p-2 text-base"
                    >
                      <option value="">{t("— sin categoría —", "— no category —")}</option>
                      {data?.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={bizum} onChange={(e) => setBizum(e.target.checked)} />
                    Bizum
                  </label>
                  <div className="flex gap-2">
                    <button type="submit" className="chip card">
                      {t("Guardar", "Save")}
                    </button>
                    <button type="button" className="chip card" onClick={() => setEditing(null)}>
                      {t("Cancelar", "Cancel")}
                    </button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </Collapsible>
  );
}
