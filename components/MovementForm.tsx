"use client";

import { useState } from "react";
import ExpensePicker from "@/components/ExpensePicker";
import { parseNumber, button, field, roundCents, today } from "@/lib/format";
import { language, t } from "@/lib/language";
import type { MovementType } from "@/lib/movements";
import { supabase } from "@/lib/supabase";

type SelectOption = { id: string; name: string };

// What gets saved for a transaction (to edit an existing one)
export type EditableMovement = {
  id: string;
  date: string;
  type: MovementType;
  amount: number;
  account_id: string | null;
  target_account_id: string | null;
  category_id: string | null;
  bizum: boolean;
  description: string | null;
  refund_of_id?: string | null; // if it's a refund: the expense it gives back
};

const TYPES: MovementType[] = ["expense", "income", "transfer"];

// Name of each transaction type in the chosen language
export function movementTypeName(type: MovementType): string {
  return {
    expense: t("Gasto", "Expense"),
    income: t("Ingreso", "Income"),
    transfer: t("Transferencia", "Transfer"),
    adjustment: t("Ajuste", "Adjustment"),
  }[type];
}

// 12.5 -> "12,50" (to fill in the amount when editing; in English, "12.50")
function text(n: number): string {
  const s = n.toFixed(2);
  return language() === "en" ? s : s.replace(".", ",");
}

// Toggles the sign of what was typed: "50" <-> "-50" (the iPhone keyboard has no "−" key)
function toggleSign(typed: string): string {
  const clean = typed.trim().replace(/−/g, "-");
  if (clean === "") return "-";
  return clean.startsWith("-") ? clean.slice(1) : `-${clean}`;
}

// Transaction form. Without "movement" it creates a new one; with "movement" it edits it.
export default function MovementForm({
  accounts,
  categories,
  movement,
  onSave,
  onCancel,
}: {
  accounts: SelectOption[];
  categories: SelectOption[];
  movement?: EditableMovement;
  onSave: () => void;
  onCancel?: () => void;
}) {
  const editing = Boolean(movement);
  const [type, setType] = useState<MovementType>(movement?.type ?? "expense");
  const [amount, setAmount] = useState(movement ? text(movement.amount) : "");
  const [date, setDate] = useState(movement?.date ?? today());
  const [accountId, setAccountId] = useState(movement?.account_id ?? ""); // "" = Cash
  const [targetId, setTargetId] = useState(movement?.target_account_id ?? "");
  const [categoryId, setCategoryId] = useState(movement?.category_id ?? ""); // "" = No category
  const [bizum, setBizum] = useState(movement?.bizum ?? false);
  const [description, setDescription] = useState(movement?.description ?? "");
  // Refund: income that gives back part of an expense (e.g. a friend's Bizum)
  const [refund, setRefund] = useState(Boolean(movement?.refund_of_id));
  const [expense, setExpense] = useState<{ id: string; category_id: string | null } | null>(
    movement?.refund_of_id
      ? { id: movement.refund_of_id, category_id: movement.category_id }
      : null,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const isTransfer = type === "transfer";
  const isAdjustment = type === "adjustment";
  const isRefund = type === "income" && refund;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");

    const quantity = parseNumber(amount.replace(/−/g, "-"));
    if (isAdjustment) {
      if (quantity === null || quantity === 0) {
        setError(
          t(
            "El ajuste debe ser un número distinto de 0, por ejemplo 25 o -25",
            "The adjustment must be a number other than 0, e.g. 25 or -25",
          ),
        );
        return;
      }
      if (!accountId) {
        setError(t("Elige la cuenta del ajuste", "Choose the account to adjust"));
        return;
      }
    } else if (quantity === null || quantity <= 0) {
      setError(
        t(
          "El importe debe ser un número mayor que 0, por ejemplo 12,50",
          "The amount must be a number over 0, e.g. 12.50",
        ),
      );
      return;
    }
    if (isTransfer) {
      if (!accountId || !targetId) {
        setError(t("Elige la cuenta de origen y la de destino", "Choose the from and to accounts"));
        return;
      }
      if (accountId === targetId) {
        setError(
          t(
            "La cuenta de origen y la de destino deben ser distintas",
            "The from and to accounts must be different",
          ),
        );
        return;
      }
    }

    if (isRefund && !expense) {
      setError(t("Elige de qué gasto es el reembolso", "Choose which expense the refund is for"));
      return;
    }

    const noCategory = isTransfer || isAdjustment;
    const row = {
      date,
      type,
      amount: roundCents(quantity),
      account_id: accountId || null,
      target_account_id: isTransfer ? targetId : null,
      // A refund takes the category of its expense
      category_id: noCategory
        ? null
        : isRefund
          ? (expense?.category_id ?? null)
          : categoryId || null,
      bizum: noCategory ? false : bizum,
      description: description.trim() || null,
      refund_of_id: isRefund ? (expense?.id ?? null) : null,
    };

    setSaving(true);
    const { error } = movement
      ? await supabase.from("movements").update(row).eq("id", movement.id)
      : await supabase.from("movements").insert(row);
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (!editing) {
      setNotice(`✅ ${movementTypeName(type)}: ${t("guardado", "saved")}`);
      setAmount("");
      setBizum(false);
      setDescription("");
      setRefund(false);
      setExpense(null);
    }
    onSave();
  }

  function changeType(newOne: MovementType) {
    setType(newOne);
    setError("");
    setNotice("");
    // A transfer can't come out of "Cash"
    if (newOne === "transfer" && !accountId && accounts[0]) {
      setAccountId(accounts[0].id);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      {isAdjustment ? (
        <p className="text-sm font-semibold">{t("Ajuste de saldo", "Balance adjustment")}</p>
      ) : (
        <div className="flex gap-2">
          {TYPES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => changeType(id)}
              className={`flex-1 rounded border p-2 text-sm ${
                type === id
                  ? "border-blue-600 bg-blue-600 font-semibold text-white"
                  : "border-gray-400"
              }`}
            >
              {movementTypeName(id)}
            </button>
          ))}
        </div>
      )}

      <label className="text-sm opacity-70">
        {isAdjustment
          ? t("Importe (€, en negativo si resta)", "Amount (€, negative if it subtracts)")
          : t("Importe (€)", "Amount (€)")}
      </label>
      <div className="flex gap-1">
        <input
          className={`${field} w-full min-w-0`}
          inputMode="decimal"
          placeholder={t("Por ejemplo 12,50", "e.g. 12.50")}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        {isAdjustment && (
          <button
            type="button"
            aria-label={t("Cambiar el signo del importe", "Change the sign of the amount")}
            onClick={() => setAmount(toggleSign(amount))}
            className="shrink-0 rounded border border-gray-400 px-3 text-base"
          >
            ±
          </button>
        )}
      </div>

      <label className="text-sm opacity-70">{t("Fecha", "Date")}</label>
      <input
        className={field}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
      />

      <label className="text-sm opacity-70">
        {isTransfer ? t("Desde la cuenta", "From account") : t("Cuenta", "Account")}
      </label>
      <select className={field} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {isTransfer || isAdjustment ? (
          <option value="">{t("Elige una cuenta", "Choose an account")}</option>
        ) : (
          <option value="">
            {t("💵 Efectivo (no toca ninguna cuenta)", "💵 Cash (no account)")}
          </option>
        )}
        {accounts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {isTransfer && (
        <>
          <label className="text-sm opacity-70">{t("A la cuenta", "To account")}</label>
          <select className={field} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
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

      {type === "income" && (
        <>
          <label className="flex items-center gap-3 py-1">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={refund}
              onChange={(e) => setRefund(e.target.checked)}
            />
            {t(
              "Es un reembolso de un gasto (te devuelven parte)",
              "It's a refund of an expense (you get part back)",
            )}
          </label>
          {refund && (
            <>
              <ExpensePicker
                date={date}
                value={expense?.id ?? ""}
                excludeId={movement?.id}
                onPick={(g) => setExpense(g ? { id: g.id, category_id: g.category_id } : null)}
              />
              <p className="text-xs opacity-70">
                {t(
                  "Se restará de ese gasto, en su mes y su categoría. El saldo de la cuenta sí sube.",
                  "It's subtracted from that expense, in its month and category. The account balance does go up.",
                )}
              </p>
            </>
          )}
        </>
      )}

      {!isTransfer && !isAdjustment && (
        <>
          {!isRefund && (
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
            </>
          )}

          <label className="flex items-center gap-3 py-1">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={bizum}
              onChange={(e) => setBizum(e.target.checked)}
            />
            {t("Ha sido por Bizum", "It was by Bizum")}
          </label>
        </>
      )}

      <label className="text-sm opacity-70">
        {t("Descripción (opcional)", "Description (optional)")}
      </label>
      <input
        className={field}
        placeholder={t("Por ejemplo: cena con amigos", "e.g. dinner with friends")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      {error && <p className="text-red-500">{error}</p>}
      {notice && <p className="text-green-600">{notice}</p>}

      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 rounded border border-gray-400 p-3 text-base"
          >
            {t("Cancelar", "Cancel")}
          </button>
        )}
        <button type="submit" disabled={saving} className={`${button} flex-1`}>
          {saving
            ? t("Guardando...", "Saving...")
            : editing
              ? t("Guardar cambios", "Save changes")
              : t("Guardar", "Save")}
        </button>
      </div>
    </form>
  );
}
