"use client";

import { useCallback, useEffect, useState } from "react";
import Collapsible from "@/components/Collapsible";
import ClassifyForm from "@/components/ClassifyForm";
import { callApi } from "@/lib/api";
import {
  findRule,
  linkKey,
  choiceFromRule,
  matchDuplicates,
  movementRow,
  suggestedText,
  type Choice,
  type AppMovement,
  type BankMovement,
  type Rule,
} from "@/lib/classify";
import { DEMO } from "@/lib/demo";
import { field, withSign, euros, prettyDate } from "@/lib/format";
import { language, t } from "@/lib/language";
import { translateMessage } from "@/lib/messages";
import { supabase } from "@/lib/supabase";

type SelectOption = { id: string; name: string };

type PendingRow = BankMovement & {
  account: { name: string | null; iban_last4: string | null; account_id: string | null } | null;
};

// What was recorded (or linked) automatically by your rules
type AutoRecorded = BankMovement & {
  auto: "recorded" | "linked";
  movement_id: string | null;
  account: { account_id: string | null } | null;
  movement: {
    type: string;
    description: string | null;
    category_id: string | null;
    account_id: string | null;
    target_account_id: string | null;
  } | null;
};

type Inbox = {
  pending: PendingRow[];
  rules: Rule[];
  app: AppMovement[];
  linked: string[]; // keys from linkKey
  autoRecorded: AutoRecorded[];
};

type InboxSummary = { hasBank: boolean; pending: number };

// What the bank hasn't booked yet (only shown, not saved)
type AtBank = { account: string; date: string; amount: number; description: string | null };

const PAGE_SIZE = 50;
const AUTO_DAYS = 7; // how many days the "Recorded automatically" list is shown

// Is any bank connected? How many transactions are waiting in the inbox?
async function fetchSummary(): Promise<InboxSummary> {
  const [accounts, pendingRows] = await Promise.all([
    supabase.from("bank_accounts").select("id", { count: "exact", head: true }),
    supabase
      .from("bank_transactions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);
  return { hasBank: (accounts.count ?? 0) > 0, pending: pendingRows.count ?? 0 };
}

// Supabase returns at most 1000 rows: fetch all the pages
async function fetchAll<T>(
  fetchPage: (from: number) => PromiseLike<{ data: unknown }>,
): Promise<T[]> {
  const list: T[] = [];
  for (let i = 0; ; i += 1000) {
    const batch = ((await fetchPage(i)).data ?? []) as T[];
    list.push(...batch);
    if (batch.length < 1000) return list;
  }
}

// The pending rows, the rules, what was recorded automatically in the last few days and, to look for duplicates,
// the app's transactions on those dates
async function fetchInbox(): Promise<Inbox> {
  const autoSince = new Date(Date.now() - AUTO_DAYS * 86400000).toISOString();
  const [pendingRows, rules, autoRecorded] = await Promise.all([
    fetchAll<PendingRow>((i) =>
      supabase
        .from("bank_transactions")
        .select(
          "id, date, amount, description, counterparty, account:bank_accounts(name, iban_last4, account_id)",
        )
        .eq("status", "pending")
        .order("date", { ascending: false })
        .order("id")
        .range(i, i + 999),
    ),
    fetchAll<Rule>((i) =>
      supabase
        .from("bank_rules")
        .select("*")
        .order("id")
        .range(i, i + 999),
    ),
    fetchAll<AutoRecorded>((i) =>
      supabase
        .from("bank_transactions")
        .select(
          "id, date, amount, description, counterparty, auto, movement_id, account:bank_accounts(account_id), movement:movements(type, description, category_id, account_id, target_account_id)",
        )
        .not("auto", "is", null)
        .gte("created_at", autoSince)
        .order("date", { ascending: false })
        .order("id")
        .range(i, i + 999),
    ),
  ]);
  if (pendingRows.length === 0)
    return {
      pending: pendingRows,
      rules,
      app: [],
      linked: [],
      autoRecorded,
    };

  const dates = pendingRows.map((p) => p.date).sort();
  const from = dates[0];
  const until = dates[dates.length - 1];
  const [appBalances, linked] = await Promise.all([
    fetchAll<AppMovement>((i) =>
      supabase
        .from("movements")
        .select("id, date, type, amount, account_id, target_account_id, description")
        .gte("date", from)
        .lte("date", until)
        .order("id")
        .range(i, i + 999),
    ),
    fetchAll<{ movement_id: string; account: { account_id: string | null } | null }>((i) =>
      supabase
        .from("bank_transactions")
        .select("movement_id, account:bank_accounts(account_id)")
        .not("movement_id", "is", null)
        .gte("date", from)
        .lte("date", until)
        .order("id")
        .range(i, i + 999),
    ),
  ]);
  return {
    pending: pendingRows,
    rules,
    app: appBalances,
    linked: linked.map((e) => linkKey(e.movement_id, e.account?.account_id ?? null)),
    autoRecorded,
  };
}

// The server's notes, in the chosen language
const tm = (text: string) => translateMessage(text, language());

// Transactions → "To review" inbox: what comes from the bank and isn't in the app yet
export default function BankInbox({
  accounts,
  categories,
  onChange,
}: {
  accounts: SelectOption[];
  categories: SelectOption[];
  onChange: () => void; // tells the history there are new transactions
}) {
  const [summary, setInboxSummary] = useState<InboxSummary | null>(null);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [fetching, setFetching] = useState(false);
  const [report, setReport] = useState<string[]>([]);
  const [atBank, setAtBank] = useState<AtBank[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notDuplicates, setNotDuplicates] = useState<string[]>([]); // "It's a different one": it isn't the suggested duplicate
  const [undo, setUndo] = useState<string[]>([]); // the last ignored ones
  const [cutoff, setCutoff] = useState("");

  const showSummary = useCallback((r: InboxSummary) => setInboxSummary(r), []);

  useEffect(() => {
    fetchSummary().then(showSummary);
  }, [showSummary]);

  if (!summary?.hasBank) return null; // with no connected banks there's no inbox

  function reload() {
    fetchSummary().then(showSummary);
    fetchInbox().then(setInbox);
  }

  function onOpen(a: boolean) {
    setOpen(a);
    if (a && !inbox) fetchInbox().then(setInbox);
  }

  async function fetchFromBank() {
    setError("");
    setReport([]);
    setAtBank([]);
    setFetching(true);
    try {
      const r = await callApi<{
        results: {
          account: string;
          added: number;
          pending?: Omit<AtBank, "account">[];
          latest?: string | null;
          notes?: string[];
          skipped?: boolean;
          error: string | null;
        }[];
        auto?: { recorded: number; linked: number; error: string | null };
      }>("/api/bank/fetch", "POST");
      const a = r.auto;
      setReport([
        ...(r.results.length === 0
          ? [
              t(
                "No hay cuentas que descargar: revisa Ajustes → 🏦 Bancos",
                "No accounts to download: check Settings → 🏦 Banks",
              ),
            ]
          : r.results.flatMap((x) => {
              if (x.error) return [`⚠️ ${x.account}: ${tm(x.error)}`];
              if (x.skipped) return [`${x.account}: ${(x.notes ?? []).map(tm).join(" ")}`];
              const p = x.pending?.length ?? 0;
              return [
                t(
                  `✅ ${x.account}: ${x.added} nuevos${p ? ` · ${p} pendiente${p > 1 ? "s" : ""} en el banco` : ""}${x.latest ? ` · último apunte del banco: ${prettyDate(x.latest)}` : ""}`,
                  `✅ ${x.account}: ${x.added} new${p ? ` · ${p} pending at the bank` : ""}${x.latest ? ` · bank's latest entry: ${prettyDate(x.latest)}` : ""}`,
                ),
                ...(x.notes ?? []).map((n) => `${x.account}: ${tm(n)}`),
              ];
            })),
        ...(a && a.recorded + a.linked > 0
          ? [
              t(
                `🤖 ${a.recorded} apuntado${a.recorded === 1 ? "" : "s"} solo${a.recorded === 1 ? "" : "s"} con tus reglas${a.linked ? ` · ${a.linked} enlazado${a.linked === 1 ? "" : "s"} con su transferencia` : ""}`,
                `🤖 ${a.recorded} recorded automatically by your rules${a.linked ? ` · ${a.linked} linked to their transfer` : ""}`,
              ),
            ]
          : []),
        ...(a?.error
          ? [
              `${t("⚠️ No se ha podido apuntar todo solo", "⚠️ Couldn't record everything automatically")}: ${tm(a.error)}`,
            ]
          : []),
      ]);
      if (a && a.recorded + a.linked > 0) onChange();
      setAtBank(
        r.results.flatMap((x) => (x.pending ?? []).map((p) => ({ ...p, account: x.account }))),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setFetching(false);
    fetchSummary().then(showSummary);
    if (open) fetchInbox().then(setInbox);
    else setInbox(null);
  }

  // Creates the transaction in the app and marks the bank one as classified
  async function record(m: PendingRow, accountId: string, e: Choice, remember: string | null) {
    setError("");
    setReport([]);
    const r = movementRow(m, accountId, e, language());
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setBusy(m.id);
    const { data: newOne, error: e1 } = await supabase
      .from("movements")
      .insert(r.row)
      .select("id")
      .single();
    if (e1 || !newOne) {
      setBusy(null);
      setError(e1?.message ?? t("No se ha podido guardar", "Couldn't save"));
      return;
    }
    const { data: marked, error: e2 } = await supabase
      .from("bank_transactions")
      .update({ status: "classified", movement_id: newOne.id })
      .eq("id", m.id)
      .eq("status", "pending")
      .select("id");
    if (e2 || !marked?.length) {
      // If it couldn't be marked, it's undone so no duplicate is left
      await supabase.from("movements").delete().eq("id", newOne.id);
      setBusy(null);
      setError(
        e2?.message ??
          t("Ese movimiento ya estaba clasificado", "That transaction was already classified"),
      );
      reload();
      return;
    }
    if (remember) {
      const { error: e3 } = await supabase.from("bank_rules").upsert(
        {
          text: remember,
          category_id: e.isTransfer ? null : e.categoryId,
          bizum: e.isTransfer ? false : e.bizum,
          is_transfer: e.isTransfer,
          other_account_id: e.isTransfer ? e.otherAccountId : null,
          description: e.description.trim() || null,
        },
        { onConflict: "user_id,text" },
      );
      if (e3)
        setError(
          `${t("Se ha apuntado, pero no se ha guardado la regla", "Recorded, but the rule wasn't saved")}: ${e3.message}`,
        );
    }
    setBusy(null);
    setEditing(null);
    setUndo([]);
    setReport([
      `${e.refundOfId ? t("↩️ Reembolso apuntado", "↩️ Refund recorded") : t("✅ Apuntado", "✅ Recorded")}: ${e.description.trim() || t("movimiento", "transaction")} ${withSign(Number(m.amount))}${remember ? ` · ${t("regla", "rule")} «${remember}» ${t("guardada", "saved")}` : ""}`,
    ]);
    onChange();
    reload();
  }

  // "It's the same one": it's linked to the one you already had, without creating anything
  async function link(m: PendingRow, a: AppMovement) {
    setError("");
    setReport([]);
    setBusy(m.id);
    const { error } = await supabase
      .from("bank_transactions")
      .update({ status: "classified", movement_id: a.id })
      .eq("id", m.id);
    setBusy(null);
    if (error) {
      setError(error.message);
      return;
    }
    setUndo([]);
    setReport([
      t(
        `🔁 Enlazado con tu movimiento «${a.description ?? a.type}» del ${prettyDate(a.date)}`,
        `🔁 Linked to your transaction «${a.description ?? a.type}» of ${prettyDate(a.date)}`,
      ),
    ]);
    reload();
  }

  async function ignore(ids: string[], text: string) {
    setError("");
    setReport([]);
    const { data, error } = await supabase
      .from("bank_transactions")
      .update({ status: "ignored" })
      .in("id", ids)
      .eq("status", "pending")
      .select("id");
    if (error) {
      setError(error.message);
      return;
    }
    setUndo((data ?? []).map((d) => d.id));
    setReport([text]);
    reload();
  }

  async function undoIgnore() {
    setError("");
    const { error } = await supabase
      .from("bank_transactions")
      .update({ status: "pending" })
      .in("id", undo)
      .eq("status", "ignored");
    if (error) {
      setError(error.message);
      return;
    }
    setReport([
      t(
        `↩️ ${undo.length === 1 ? "Ha vuelto" : `Han vuelto ${undo.length}`} a la bandeja`,
        `↩️ ${undo.length === 1 ? "1 is" : `${undo.length} are`} back in the inbox`,
      ),
    ]);
    setUndo([]);
    reload();
  }

  // Sends back to the inbox something that was recorded automatically: if a transaction was created, it's deleted
  // (the devolver_a_bandeja trigger sends it back); if it was only linked, it's unlinked
  // "rule": the rule that recorded it. If given, it is deleted too, so it stops applying to future ones
  async function sendBack(a: AutoRecorded, rule: Rule | null = null) {
    setError("");
    setReport([]);
    if (a.auto === "recorded" && a.movement_id) {
      const question = rule
        ? t(
            `Se borrará el movimiento apuntado, volverá a la bandeja y se borrará la regla «${rule.text}»: no se aplicará a los próximos movimientos. ¿Seguro?`,
            `The recorded transaction will be deleted and go back to the inbox, and the rule «${rule.text}» will be deleted: it won't apply to future ones. Sure?`,
          )
        : t(
            "Se borrará el movimiento apuntado y volverá a la bandeja. ¿Seguro?",
            "The recorded transaction will be deleted and go back to the inbox. Sure?",
          );
      if (!confirm(question)) return;
      setBusy(a.id);
      const { error } = await supabase.from("movements").delete().eq("id", a.movement_id);
      setBusy(null);
      if (error) {
        setError(error.message);
        return;
      }
    } else {
      setBusy(a.id);
      const { error } = await supabase
        .from("bank_transactions")
        .update({ status: "pending", movement_id: null, auto: null })
        .eq("id", a.id);
      setBusy(null);
      if (error) {
        setError(error.message);
        return;
      }
    }
    let ruleNote = "";
    if (rule) {
      const { error: e2 } = await supabase.from("bank_rules").delete().eq("id", rule.id);
      if (e2) {
        setError(
          `${t("Volvió a la bandeja, pero no se pudo borrar la regla", "It went back to the inbox, but the rule couldn't be deleted")}: ${e2.message}`,
        );
      } else {
        ruleNote = ` · ${t("regla", "rule")} «${rule.text}» ${t("borrada", "deleted")}`;
      }
    }
    const name = a.description ?? a.counterparty ?? t("Movimiento", "Transaction");
    setReport([
      t(
        `↩️ «${name}» ha vuelto a la bandeja${ruleNote}`,
        `↩️ «${name}» is back in the inbox${ruleNote}`,
      ),
    ]);
    onChange();
    reload();
  }

  function ignoreOlder() {
    if (!inbox || !cutoff) return;
    const ids = inbox.pending.filter((p) => p.date < cutoff).map((p) => p.id);
    if (ids.length === 0) {
      setReport([
        t(
          `No hay nada pendiente anterior al ${prettyDate(cutoff)}`,
          `Nothing pending before ${prettyDate(cutoff)}`,
        ),
      ]);
      return;
    }
    const count =
      ids.length === 1
        ? t(
            `1 movimiento anterior al ${prettyDate(cutoff)}`,
            `1 transaction before ${prettyDate(cutoff)}`,
          )
        : t(
            `${ids.length} movimientos anteriores al ${prettyDate(cutoff)}`,
            `${ids.length} transactions before ${prettyDate(cutoff)}`,
          );
    if (!confirm(t(`¿Dar por apuntado ${count}?`, `Mark ${count} as already recorded?`))) return;
    ignore(
      ids,
      t(
        `🙈 ${count}: dado${ids.length === 1 ? "" : "s"} por apuntado${ids.length === 1 ? "" : "s"}`,
        `🙈 ${count}: marked as already recorded`,
      ),
    );
  }

  // For each pending row: its account in the app, the possible duplicate and the matching rule
  const pendingRows = inbox?.pending ?? [];
  const pairs = inbox
    ? matchDuplicates(
        pendingRows.map((m) => ({ m, accountId: m.account?.account_id ?? null })),
        inbox.app,
        new Set(inbox.linked),
      )
    : new Map<string, AppMovement>();
  const categoryName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? t("Sin categoría", "No category");
  const accountName = (id: string | null) => accounts.find((c) => c.id === id)?.name ?? "?";

  return (
    <Collapsible
      title={t("📥 Por clasificar", "📥 To review")}
      onOpen={onOpen}
      summary={
        <span className={`text-sm ${summary.pending > 0 ? "text-orange-500" : "opacity-60"}`}>
          {summary.pending}
        </span>
      }
    >
      {/* In the demo the transactions are already here: there's no bank to fetch from */}
      {!DEMO && (
        <button
          onClick={fetchFromBank}
          disabled={fetching}
          className="self-start text-sm underline disabled:opacity-50"
        >
          {fetching
            ? t("Trayendo...", "Fetching...")
            : t("🔄 Traer movimientos del banco", "🔄 Fetch bank transactions")}
        </button>
      )}

      {report.map((line) => (
        <p
          key={line}
          className={`text-sm ${line.startsWith("⚠️") ? "text-orange-500" : "text-green-600"}`}
        >
          {line}
        </p>
      ))}
      {undo.length > 0 && (
        <button onClick={undoIgnore} className="self-start text-sm text-blue-600 underline">
          {t("Deshacer", "Undo")}
        </button>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* ---------- What the bank hasn't booked yet ---------- */}
      {atBank.length > 0 && (
        <div className="flex flex-col gap-1 rounded border border-dashed border-gray-400/70 p-2 text-sm">
          <p className="font-semibold">{t("⏳ Pendiente en el banco", "⏳ Pending at the bank")}</p>
          <p className="text-xs opacity-70">
            {t(
              "El banco aún no los ha apuntado. Llegarán aquí para clasificarlos cuando lo haga (normalmente al día siguiente).",
              "The bank hasn't booked them yet. They'll arrive here to classify when it does (usually the next day).",
            )}
          </p>
          {atBank.map((p, i) => (
            <div key={i} className="flex justify-between gap-3 opacity-70">
              <span className="min-w-0 break-words">
                {prettyDate(p.date)} · {p.description ?? t("Sin descripción", "No description")}
              </span>
              <span className="shrink-0">{withSign(Number(p.amount))}</span>
            </div>
          ))}
        </div>
      )}

      {!inbox ? (
        <p className="text-sm opacity-70">{t("Cargando...", "Loading...")}</p>
      ) : pendingRows.length === 0 ? (
        <p className="text-sm opacity-70">
          {t("No hay nada por clasificar.", "Nothing to review.")}
        </p>
      ) : (
        <>
          <p className="text-xs opacity-70">
            {t(
              "Hasta que los apuntes, no cuentan en tus saldos ni en tus gastos.",
              "Until you record them, they don't count in your balances or your spending.",
            )}
          </p>

          {/* ---------- Mark everything before a date as recorded ---------- */}
          <details className="rounded border border-gray-400/50 p-2 text-sm">
            <summary className="cursor-pointer">
              {t(
                "¿Ya tenías apuntado lo anterior a una fecha?",
                "Already recorded everything before a date?",
              )}
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-xs opacity-70">
                {t(
                  "Los pendientes de antes de ese día se marcan como ya apuntados y salen de la bandeja, sin crear nada.",
                  "Pending items before that day are marked as already recorded and leave the inbox, without creating anything.",
                )}
              </p>
              <input
                className={field}
                type="date"
                value={cutoff}
                onChange={(e) => setCutoff(e.target.value)}
              />
              <button
                onClick={ignoreOlder}
                disabled={!cutoff}
                className="rounded border border-gray-400 p-2 disabled:opacity-50"
              >
                {t("Dar por apuntado lo anterior", "Mark earlier ones as recorded")}
              </button>
            </div>
          </details>

          <ul className="flex flex-col gap-2">
            {pendingRows.slice(0, visibleCount).map((m) => {
              const accountId = m.account?.account_id ?? null;
              const duplicate = notDuplicates.includes(m.id) ? undefined : pairs.get(m.id);
              const rule = findRule(inbox.rules, m, accountId);
              const bankName = `${m.account?.name ?? t("Cuenta", "Account")}${m.account?.iban_last4 ? ` ···${m.account.iban_last4}` : ""}`;
              const idle = busy === null;

              if (editing === m.id && accountId)
                return (
                  <li key={m.id} className="rounded border border-blue-600 p-3 text-sm">
                    <p className="font-semibold">
                      ✏️ {m.description ?? m.counterparty ?? t("Movimiento", "Transaction")} ·{" "}
                      {withSign(Number(m.amount))}
                    </p>
                    <p className="mb-3 opacity-70">
                      {prettyDate(m.date)} · {accountName(accountId)}
                    </p>
                    <ClassifyForm
                      m={m}
                      accountId={accountId}
                      accounts={accounts}
                      categories={categories}
                      initial={
                        rule
                          ? choiceFromRule(rule, m)
                          : {
                              isTransfer: false,
                              categoryId: null,
                              bizum: false,
                              otherAccountId: null,
                              description: m.counterparty ?? m.description ?? "",
                            }
                      }
                      ruleText={rule?.text ?? suggestedText(m)}
                      saving={busy === m.id}
                      onSave={(e, remember) => record(m, accountId, e, remember)}
                      onCancel={() => setEditing(null)}
                    />
                  </li>
                );

              return (
                <li
                  key={m.id}
                  className="flex flex-col gap-2 rounded border border-gray-400/50 p-2 text-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-medium">
                        {m.description ?? m.counterparty ?? t("Sin descripción", "No description")}
                      </p>
                      {m.counterparty && m.description && (
                        <p className="break-words opacity-70">{m.counterparty}</p>
                      )}
                      <p className="opacity-70">
                        {prettyDate(m.date)} · {accountId ? accountName(accountId) : bankName}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 font-bold ${Number(m.amount) > 0 ? "text-green-600" : ""}`}
                    >
                      {withSign(Number(m.amount))}
                    </p>
                  </div>

                  {!accountId ? (
                    <p className="text-orange-500">
                      {t(
                        "Elige a qué cuenta corresponde en Ajustes → 🏦 Bancos",
                        "Choose its account in Settings → 🏦 Banks",
                      )}
                    </p>
                  ) : duplicate ? (
                    <div className="flex flex-col gap-2 rounded bg-blue-500/10 p-2">
                      <p>
                        {t("🔁 Ya lo tienes apuntado", "🔁 You already have it")}: «
                        {duplicate.description ?? duplicate.type}» · {prettyDate(duplicate.date)} ·{" "}
                        {euros(Number(duplicate.amount))}
                      </p>
                      <div className="flex gap-4">
                        <button
                          onClick={() => link(m, duplicate)}
                          disabled={!idle}
                          className="rounded bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-50"
                        >
                          {t("Es el mismo", "Same one")}
                        </button>
                        <button
                          onClick={() => setNotDuplicates((o) => [...o, m.id])}
                          className="text-blue-600 underline"
                        >
                          {t("Es otro", "Different one")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    rule && (
                      <p className="opacity-80">
                        💡{" "}
                        {rule.is_transfer
                          ? `${Number(m.amount) < 0 ? t("Transferencia a", "Transfer to") : t("Transferencia desde", "Transfer from")} ${accountName(rule.other_account_id)}`
                          : categoryName(rule.category_id)}
                        {rule.bizum && !rule.is_transfer ? " · Bizum" : ""} · {t("regla", "rule")} «
                        {rule.text}»
                      </p>
                    )
                  )}

                  <div className="flex items-center gap-4">
                    {accountId && rule && !duplicate && (
                      <button
                        onClick={() => record(m, accountId, choiceFromRule(rule, m), null)}
                        disabled={!idle}
                        className="rounded bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-50"
                      >
                        {busy === m.id ? t("Apuntando...", "Recording...") : t("Apuntar", "Record")}
                      </button>
                    )}
                    {accountId && !duplicate && (
                      <button
                        onClick={() => {
                          setEditing(m.id);
                          setError("");
                        }}
                        disabled={!idle}
                        className="text-blue-600 underline disabled:opacity-50"
                      >
                        {rule ? t("Cambiar", "Change") : t("Clasificar", "Classify")}
                      </button>
                    )}
                    <button
                      onClick={() => ignore([m.id], t("🙈 Ignorado", "🙈 Ignored"))}
                      disabled={!idle}
                      className="text-red-500 underline disabled:opacity-50"
                    >
                      {t("Ignorar", "Ignore")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {pendingRows.length > visibleCount && (
        <button
          onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
          className="rounded border border-gray-400 p-3 text-base"
        >
          {t("Ver más", "Show more")} ({pendingRows.length - visibleCount} {t("más", "more")})
        </button>
      )}
      {/* ---------- What was recorded automatically ---------- */}
      {inbox && inbox.autoRecorded.length > 0 && (
        <details className="rounded border border-gray-400/50 p-2 text-sm">
          <summary className="cursor-pointer">
            {t("🤖 Apuntados solos", "🤖 Auto-recorded")} ({inbox.autoRecorded.length}) ·{" "}
            {t(`últimos ${AUTO_DAYS} días`, `last ${AUTO_DAYS} days`)}
          </summary>
          <p className="mt-2 text-xs opacity-70">
            {t(
              "Se apuntaron con tus reglas al traerlos del banco. Si alguno está mal, devuélvelo a la bandeja; si ya no quieres la regla, devuélvelo y bórrala a la vez. Todas tus reglas se ven y se editan en Ajustes → Reglas del banco.",
              "They were recorded by your rules when fetched from the bank. If one is wrong, send it back to the inbox; if you no longer want the rule, send it back and delete it at once. All your rules can be seen and edited in Settings → Bank rules.",
            )}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {inbox.autoRecorded.map((a) => {
              const mov = a.movement;
              // The rule that recorded it (found again from the bank text)
              const rule =
                a.auto === "recorded"
                  ? findRule(inbox.rules, a, a.account?.account_id ?? null)
                  : null;
              const how =
                a.auto === "linked"
                  ? t("🔁 Enlazado con su transferencia", "🔁 Linked to its transfer")
                  : !mov
                    ? ""
                    : mov.type === "transfer"
                      ? `${t("Transferencia", "Transfer")} ${accountName(mov.account_id)} → ${accountName(mov.target_account_id)}`
                      : `${mov.type === "expense" ? t("Gasto", "Expense") : t("Ingreso", "Income")} · ${categoryName(mov.category_id)}`;
              return (
                <li
                  key={a.id}
                  className="flex flex-col gap-1 border-t border-gray-400/30 pt-2 first:border-0 first:pt-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words">
                      {prettyDate(a.date)} ·{" "}
                      {mov?.description ??
                        a.description ??
                        a.counterparty ??
                        t("Sin descripción", "No description")}
                    </span>
                    <span className={`shrink-0 ${Number(a.amount) > 0 ? "text-green-600" : ""}`}>
                      {withSign(Number(a.amount))}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="opacity-70">
                      {how}
                      {rule ? ` · ${t("regla", "rule")} «${rule.text}»` : ""}
                    </span>
                    <span className="flex flex-wrap gap-x-4 gap-y-1">
                      <button
                        onClick={() => sendBack(a)}
                        disabled={busy !== null}
                        className="text-blue-600 underline disabled:opacity-50"
                      >
                        {busy === a.id
                          ? t("Devolviendo...", "Sending back...")
                          : t("↩️ A la bandeja", "↩️ Back to inbox")}
                      </button>
                      {rule && (
                        <button
                          onClick={() => sendBack(a, rule)}
                          disabled={busy !== null}
                          className="text-red-500 underline disabled:opacity-50"
                        >
                          {t("↩️ A la bandeja y borrar regla", "↩️ Back to inbox and delete rule")}
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </Collapsible>
  );
}
