"use client";

import { useState } from "react";
import ExpensePicker from "@/components/ExpensePicker";
import { normalize, type Choice, type BankMovement } from "@/lib/classify";
import { button, field } from "@/lib/format";
import { t } from "@/lib/language";

type SelectOption = { id: string; name: string };

type Mode = "normal" | "transfer" | "refund";

// Form to classify a bank transaction. The sign decides whether it's an expense or income;
// it can also be a transfer between your accounts or, if money comes in, the refund
// of an expense (e.g. a friend's Bizum for the dinner you paid for).
export default function ClassifyForm({
  m,
  accountId,
  accounts,
  categories,
  initial,
  ruleText,
  saving,
  onSave,
  onCancel,
}: {
  m: BankMovement;
  accountId: string;
  accounts: SelectOption[];
  categories: SelectOption[];
  initial: Choice;
  ruleText: string;
  saving: boolean;
  onSave: (e: Choice, remember: string | null) => void;
  onCancel: () => void;
}) {
  const isOutgoing = Number(m.amount) < 0;
  const [mode, setMode] = useState<Mode>(
    initial.refundOfId ? "refund" : initial.isTransfer ? "transfer" : "normal",
  );
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? "");
  const [bizum, setBizum] = useState(initial.bizum);
  const [otherAccountId, setOtherAccountId] = useState(initial.otherAccountId ?? "");
  const [expense, setExpense] = useState<{ id: string; category_id: string | null } | null>(
    initial.refundOfId ? { id: initial.refundOfId, category_id: initial.categoryId } : null,
  );
  const [description, setDescription] = useState(initial.description);
  const [remember, setRemember] = useState(false);
  const [text, setText] = useState(ruleText);
  const [error, setError] = useState("");

  const transfer = mode === "transfer";
  const refund = mode === "refund";

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (refund && !expense) {
      setError(t("Elige de qué gasto es el reembolso", "Choose which expense the refund is for"));
      return;
    }
    if (remember && !refund && normalize(text).length < 3) {
      setError(
        t("Escribe al menos 3 letras para recordarlo", "Enter at least 3 letters to remember it"),
      );
      return;
    }
    onSave(
      {
        isTransfer: transfer,
        // A refund takes the category of its expense
        categoryId: transfer ? null : refund ? (expense?.category_id ?? null) : categoryId || null,
        bizum: transfer ? false : bizum,
        otherAccountId: transfer ? otherAccountId || null : null,
        description,
        refundOfId: refund ? (expense?.id ?? null) : null,
      },
      // A refund belongs to one specific expense: it makes no sense to remember it
      remember && !refund ? normalize(text) : null,
    );
  }

  const buttonClass = (asset: boolean) =>
    `flex-1 rounded border p-2 text-sm ${
      asset ? "border-accent bg-accent font-semibold text-on-accent" : "border-line"
    }`;

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("normal")}
          className={buttonClass(mode === "normal")}
        >
          {isOutgoing ? t("Gasto", "Expense") : t("Ingreso", "Income")}
        </button>
        <button type="button" onClick={() => setMode("transfer")} className={buttonClass(transfer)}>
          {t("Transferencia", "Transfer")}
        </button>
        {!isOutgoing && (
          <button type="button" onClick={() => setMode("refund")} className={buttonClass(refund)}>
            {t("Reembolso", "Refund")}
          </button>
        )}
      </div>

      {transfer && (
        <>
          <label className="text-sm opacity-70">
            {isOutgoing
              ? t("A qué cuenta va", "Account it goes to")
              : t("De qué cuenta viene", "Account it comes from")}
          </label>
          <select
            className={field}
            value={otherAccountId}
            onChange={(e) => setOtherAccountId(e.target.value)}
          >
            <option value="">{t("Elige una cuenta", "Choose an account")}</option>
            {accounts
              .filter((c) => c.id !== accountId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </>
      )}

      {refund && (
        <>
          <label className="text-sm opacity-70">
            {t(
              "¿De qué gasto es? (lo que te devuelven)",
              "Which expense is it for? (what you get back)",
            )}
          </label>
          <ExpensePicker
            date={m.date}
            value={expense?.id ?? ""}
            onPick={(g) => setExpense(g ? { id: g.id, category_id: g.category_id } : null)}
          />
          <p className="text-xs opacity-70">
            {t(
              "Se restará de ese gasto, en su mes y su categoría. Tu saldo no cambia: el dinero sí ha entrado.",
              "It's subtracted from that expense, in its month and category. Your balance is right: the money did come in.",
            )}
          </p>
        </>
      )}

      {mode === "normal" && (
        <>
          <label className="text-sm opacity-70">{t("Categoría", "Category")}</label>
          <select
            className={field}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">{t("Sin categoría", "No category")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {!isOutgoing && !categoryId && (
            <p className="text-xs opacity-70">
              {t(
                "Un ingreso sin categoría (como la nómina) no cuenta en el análisis de gastos.",
                "Income with no category (like your salary) doesn't count in the spending analysis.",
              )}
            </p>
          )}
        </>
      )}

      {!transfer && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={bizum} onChange={(e) => setBizum(e.target.checked)} />
          Bizum
        </label>
      )}

      <label className="text-sm opacity-70">{t("Descripción", "Description")}</label>
      <input
        className={field}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      {!refund && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t("Recordar para la próxima vez", "Remember for next time")}
        </label>
      )}
      {remember && !refund && (
        <>
          <input className={field} value={text} onChange={(e) => setText(e.target.value)} />
          <p className="text-xs opacity-70">
            {t(
              "Se propondrá lo mismo para los movimientos que contengan este texto (da igual mayúsculas o acentos).",
              "The same will be suggested for transactions containing this text (case and accents don't matter).",
            )}
          </p>
        </>
      )}

      {error && <p className="text-sm text-down">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 rounded-xl border border-line bg-surface p-3 text-base"
        >
          {t("Cancelar", "Cancel")}
        </button>
        <button type="submit" disabled={saving} className={`${button} flex-1`}>
          {saving ? t("Guardando...", "Saving...") : t("Guardar", "Save")}
        </button>
      </div>
    </form>
  );
}
