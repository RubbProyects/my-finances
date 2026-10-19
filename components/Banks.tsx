"use client";

import { useCallback, useEffect, useState } from "react";
import Collapsible from "@/components/Collapsible";
import { callApi } from "@/lib/api";
import {
  compareBalances,
  inEuros,
  BALANCE_NAMES,
  BALANCE_NAMES_EN,
  type Comparison,
} from "@/lib/bank";
import { button, field, withSign, euros, prettyDate, today } from "@/lib/format";
import { language, t } from "@/lib/language";
import { translateMessage } from "@/lib/messages";
import { supabase } from "@/lib/supabase";

type SelectOption = { id: string; name: string };

type BankAccount = {
  id: string;
  name: string | null;
  iban_last4: string | null;
  account_id: string | null;
  currency: string | null;
};

type Connection = {
  id: string;
  bank: string;
  valid_until: string | null;
  last_fetch_at: string | null;
  accounts: BankAccount[];
  days: number | null; // days left on the permission (negative = expired)
};

type ViewData = { connections: Connection[]; accounts: SelectOption[]; error: string };

// The balance the bank reports for each of its accounts (from /api/bank/balances)
type AccountBalance = {
  id: string;
  account: string;
  accountId: string | null;
  balance: { amount: number; type: string; date: string | null } | null;
  error: string | null;
};

type Compared = { balances: AccountBalance[]; rows: Comparison[] };

// What the app says when coming back from the bank's website
export type BankNotice = { ok: boolean; text: string };

const COUNTRIES = [
  { id: "ES", name: "España", en: "Spain" },
  { id: "LT", name: "Lituania (Revolut)", en: "Lithuania (Revolut)" },
  { id: "DE", name: "Alemania", en: "Germany" },
  { id: "IE", name: "Irlanda", en: "Ireland" },
  { id: "FR", name: "Francia", en: "France" },
  { id: "NL", name: "Países Bajos", en: "Netherlands" },
  { id: "PT", name: "Portugal", en: "Portugal" },
  { id: "IT", name: "Italia", en: "Italy" },
  { id: "BE", name: "Bélgica", en: "Belgium" },
];

const DAY_MS = 24 * 3600 * 1000;

async function fetchViewData(): Promise<ViewData> {
  const [connectionsRes, accountsRes] = await Promise.all([
    supabase
      .from("bank_connections")
      .select(
        "id, bank, valid_until, last_fetch_at, accounts:bank_accounts(id, name, iban_last4, account_id, currency)",
      )
      .eq("status", "active")
      .order("created_at"),
    supabase
      .from("assets")
      .select("id, name, asset_types!inner(valuation)")
      .eq("asset_types.valuation", "balance")
      .order("created_at"),
  ]);
  const failure = connectionsRes.error || accountsRes.error;
  const now = Date.now();
  return {
    connections: ((connectionsRes.data ?? []) as Omit<Connection, "days">[]).map((c) => ({
      ...c,
      days: c.valid_until ? Math.floor((new Date(c.valid_until).getTime() - now) / DAY_MS) : null,
    })),
    accounts: (accountsRes.data ?? []) as unknown as SelectOption[],
    error: failure ? failure.message : "",
  };
}

// The balance of each account in the app and what is waiting in the inbox, to compare with the bank
async function compare(balances: AccountBalance[]): Promise<Compared> {
  const [balancesRes, pendingRows] = await Promise.all([
    supabase.from("account_balances").select("account_id, balance"),
    (async () => {
      const list: { amount: number; account: { account_id: string | null } | null }[] = [];
      for (let i = 0; ; i += 1000) {
        const { data, error } = await supabase
          .from("bank_transactions")
          .select("amount, account:bank_accounts(account_id)")
          .eq("status", "pending")
          .order("id")
          .range(i, i + 999);
        if (error) throw new Error(error.message);
        list.push(...((data ?? []) as unknown as typeof list));
        if ((data?.length ?? 0) < 1000) return list;
      }
    })(),
  ]);
  if (balancesRes.error) throw new Error(balancesRes.error.message);
  const appBalances = new Map<string, number>(
    (balancesRes.data ?? []).map((f) => [f.account_id, Number(f.balance ?? 0)]),
  );
  const rows = compareBalances(
    balances
      .filter((x) => x.balance)
      .map((x) => ({ accountId: x.accountId, amount: x.balance!.amount })),
    appBalances,
    pendingRows.map((p) => ({ accountId: p.account?.account_id ?? null, amount: p.amount })),
  );
  return { balances, rows };
}

async function fetchBanks(country: string): Promise<{ banks: string[]; error: string }> {
  try {
    const r = await callApi<{ banks: { name: string; beta: boolean }[] }>(
      `/api/bank/banks?country=${country}`,
    );
    return { banks: r.banks.map((b) => b.name), error: "" };
  } catch (e) {
    return { banks: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// Settings → Banks: connect a bank (read-only) and say which account each one belongs to
export default function Banks({ notice }: { notice: BankNotice | null }) {
  const [viewData, setViewData] = useState<ViewData | null>(null);
  const [country, setCountry] = useState("ES");
  const [banks, setBanks] = useState<string[] | null>(null);
  const [bank, setBank] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compared, setCompared] = useState<Compared | null>(null);
  const [adjusted, setAdjusted] = useState("");

  const show = useCallback((d: ViewData) => {
    setViewData(d);
    setError(d.error);
  }, []);
  const showBanks = useCallback((r: { banks: string[]; error: string }) => {
    setBanks(r.banks);
    setBank(r.banks.find((b) => /santander/i.test(b)) ?? r.banks[0] ?? "");
    if (r.error) setError(r.error);
  }, []);

  // When coming back from the bank the section is open: load the data right away
  useEffect(() => {
    if (notice) {
      fetchViewData().then(show);
      fetchBanks("ES").then(showBanks);
    }
  }, [notice, show, showBanks]);

  function onOpen(open: boolean) {
    if (open && !viewData) fetchViewData().then(show);
    if (open && !banks) fetchBanks(country).then(showBanks);
  }

  function changeCountry(p: string) {
    setCountry(p);
    setBanks(null);
    setError("");
    fetchBanks(p).then(showBanks);
  }

  async function connect() {
    if (!bank) return;
    setError("");
    setConnecting(true);
    try {
      const { url } = await callApi<{ url: string }>("/api/bank/connect", "POST", {
        bank,
        country,
      });
      window.location.href = url; // to the bank's website; when done it comes back to the app
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConnecting(false);
    }
  }

  async function assign(c: BankAccount, accountId: string) {
    setError("");
    const { error } = await supabase
      .from("bank_accounts")
      .update({ account_id: accountId || null })
      .eq("id", c.id);
    if (error) setError(error.message);
    fetchViewData().then(show);
  }

  async function compareWithBank() {
    setError("");
    setAdjusted("");
    setComparing(true);
    try {
      const r = await callApi<{ balances: AccountBalance[] }>("/api/bank/balances");
      setCompared(await compare(r.balances));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setComparing(false);
  }

  // Creates an adjustment for the difference, dated today, so the app says the same as the bank
  async function adjust(f: Comparison, name: string) {
    if (!compared) return;
    const question = t(
      `¿Crear un ajuste de ${withSign(f.difference)} en ${name}?`,
      `Create an adjustment of ${withSign(f.difference)} in ${name}?`,
    );
    if (!confirm(question)) return;
    setError("");
    setComparing(true);
    const { error } = await supabase.from("movements").insert({
      date: today(),
      type: "adjustment",
      amount: f.difference,
      account_id: f.accountId,
      description: t("Ajuste con el saldo del banco", "Adjustment to the bank balance"),
    });
    if (error) setError(error.message);
    else {
      setAdjusted(
        t(
          `✅ Ajuste de ${withSign(f.difference)} creado en ${name}`,
          `✅ Adjustment of ${withSign(f.difference)} created in ${name}`,
        ),
      );
      try {
        setCompared(await compare(compared.balances));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setComparing(false);
  }

  const connections = viewData?.connections ?? [];
  const appAccountName = (id: string) =>
    viewData?.accounts.find((a) => a.id === id)?.name ?? t("Cuenta", "Account");
  const balanceNames = language() === "en" ? BALANCE_NAMES_EN : BALANCE_NAMES;

  return (
    <Collapsible
      title={t("🏦 Bancos", "🏦 Banks")}
      open={notice !== null}
      onOpen={onOpen}
      summary={
        viewData ? <span className="text-sm opacity-60">{connections.length}</span> : undefined
      }
    >
      {notice && <p className={notice.ok ? "text-green-600" : "text-orange-500"}>{notice.text}</p>}
      {error && <p className="text-red-500">{error}</p>}
      {!viewData && <p className="text-sm opacity-70">{t("Cargando...", "Loading...")}</p>}

      {/* ---------- Connected banks ---------- */}
      {connections.map((connection) => {
        const days = connection.days;
        return (
          <div
            key={connection.id}
            className="flex flex-col gap-2 rounded border border-gray-400/50 p-2"
          >
            <p className="font-semibold">{connection.bank}</p>
            {connection.valid_until && (
              <p
                className={`text-sm ${days !== null && days < 15 ? "text-orange-500" : "opacity-70"}`}
              >
                {days !== null && days < 0
                  ? t(
                      "⚠️ El permiso ha caducado: vuelve a conectar el banco",
                      "⚠️ The permission has expired: connect the bank again",
                    )
                  : `${days !== null && days < 15 ? "⚠️ " : ""}${t("Permiso hasta el", "Permission until")} ${prettyDate(connection.valid_until.slice(0, 10))}`}
              </p>
            )}
            {connection.last_fetch_at && (
              <p className="text-sm opacity-70">
                {t("Última descarga", "Last download")}:{" "}
                {prettyDate(connection.last_fetch_at.slice(0, 10))}
              </p>
            )}
            {connection.accounts.map((c) =>
              !inEuros(c.currency) ? (
                <p key={c.id} className="text-sm opacity-70">
                  {c.name ?? t("Cuenta", "Account")}
                  {c.iban_last4 ? ` ···${c.iban_last4}` : ""} ·{" "}
                  {t(
                    `💱 en ${c.currency}: no se lee (la app solo lleva euros)`,
                    `💱 in ${c.currency}: not read (the app only handles euros)`,
                  )}
                </p>
              ) : (
                <label key={c.id} className="flex flex-col gap-1 text-sm">
                  <span>
                    {c.name ?? t("Cuenta", "Account")}
                    {c.iban_last4 ? ` ···${c.iban_last4}` : ""} →{" "}
                    {t("cuenta en la app", "app account")}:
                  </span>
                  <select
                    className={field}
                    value={c.account_id ?? ""}
                    onChange={(e) => assign(c, e.target.value)}
                  >
                    <option value="">{t("Sin elegir", "Not chosen")}</option>
                    {(viewData?.accounts ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              ),
            )}
          </div>
        );
      })}

      {/* ---------- Compare with the bank balance ---------- */}
      {connections.length > 0 && (
        <button
          onClick={compareWithBank}
          disabled={comparing}
          className="self-start text-sm underline disabled:opacity-50"
        >
          {comparing
            ? t("Preguntando al banco...", "Asking the bank...")
            : t("⚖️ Comparar con el saldo del banco", "⚖️ Compare with the bank balance")}
        </button>
      )}
      {adjusted && <p className="text-sm text-green-600">{adjusted}</p>}
      {compared && (
        <div className="flex flex-col gap-2 text-sm">
          {compared.balances
            .filter((x) => x.error || (x.balance && !x.accountId))
            .map((x) => (
              <p key={x.id} className="text-orange-500">
                ⚠️ {x.account}:{" "}
                {(x.error && translateMessage(x.error, language())) ??
                  t("elige a qué cuenta de la app corresponde", "choose which app account it is")}
              </p>
            ))}
          {compared.rows.map((f) => {
            const name = appAccountName(f.accountId);
            const fromBank = compared.balances.find(
              (x) => x.accountId === f.accountId && x.balance,
            );
            const matches = Math.abs(f.difference) < 0.005;
            return (
              <div
                key={f.accountId}
                className="flex flex-col gap-1 rounded border border-gray-400/50 p-2"
              >
                <p className="font-semibold">{name}</p>
                <div className="flex justify-between gap-3">
                  <span>
                    {t("Banco", "Bank")}
                    <span className="block text-xs opacity-70">
                      {balanceNames[fromBank?.balance?.type ?? ""] ?? t("saldo", "balance")}
                      {fromBank?.balance?.date ? ` · ${prettyDate(fromBank.balance.date)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0">{euros(f.bank)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>App</span>
                  <span className="shrink-0">{euros(f.app)}</span>
                </div>
                {f.pending !== 0 && (
                  <div className="flex justify-between gap-3">
                    <span>
                      {t("En la bandeja", "In the inbox")}
                      <span className="block text-xs opacity-70">
                        {t("el banco ya lo cuenta", "the bank already counts it")}
                      </span>
                    </span>
                    <span className="shrink-0">{withSign(f.pending)}</span>
                  </div>
                )}
                {matches ? (
                  <p className="text-green-600">{t("✅ Cuadra", "✅ It matches")}</p>
                ) : (
                  <>
                    <p className="font-semibold text-orange-500">
                      {t("⚠️ Diferencia", "⚠️ Difference")}: {withSign(f.difference)}
                    </p>
                    <p className="text-xs opacity-70">
                      {t(
                        "Puede ser algo que no viene del banco (un movimiento apuntado en otra cuenta, un ajuste antiguo...) o algo de hoy que el banco aún no ha apuntado. Si lo tienes claro, «Ajustar» crea un ajuste por la diferencia con fecha de hoy.",
                        "It may be something that doesn't come from the bank (a transaction recorded in another account, an old adjustment...) or something from today the bank hasn't booked yet. If you're sure, «Adjust» creates an adjustment for the difference dated today.",
                      )}
                    </p>
                    <button onClick={() => adjust(f, name)} disabled={comparing} className={button}>
                      {t("Ajustar", "Adjust")} {withSign(f.difference)}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- Connect another bank ---------- */}
      <p className="text-sm font-semibold">{t("Conectar un banco", "Connect a bank")}</p>
      <p className="text-xs opacity-70">
        {t(
          "Solo lectura: la app puede ver tus movimientos, nunca mover dinero. Te llevará a la web de tu banco para dar permiso y volverás aquí. El permiso dura unos meses; para renovarlo, conéctalo otra vez.",
          "Read only: the app can see your transactions, never move money. It takes you to your bank's website to give permission and you come back here. The permission lasts a few months; to renew it, connect again.",
        )}
      </p>
      <select className={field} value={country} onChange={(e) => changeCountry(e.target.value)}>
        {COUNTRIES.map((p) => (
          <option key={p.id} value={p.id}>
            {t(p.name, p.en)}
          </option>
        ))}
      </select>
      {banks === null ? (
        <p className="text-sm opacity-70">{t("Cargando bancos...", "Loading banks...")}</p>
      ) : banks.length === 0 ? (
        <p className="text-sm opacity-70">
          {t("No hay bancos para ese país.", "No banks for that country.")}
        </p>
      ) : (
        <>
          <select className={field} value={bank} onChange={(e) => setBank(e.target.value)}>
            {banks.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button onClick={connect} disabled={connecting || !bank} className={button}>
            {connecting
              ? t("Abriendo el banco...", "Opening the bank...")
              : t("Conectar", "Connect")}
          </button>
        </>
      )}
    </Collapsible>
  );
}
