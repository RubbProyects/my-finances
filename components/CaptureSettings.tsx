"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAccounts, type Account } from "@/components/Accounts";
import Collapsible from "@/components/Collapsible";
import { callApi } from "@/lib/api";
import { daysBetween, isMissing, lagSummary } from "@/lib/captures";
import { DEMO } from "@/lib/demo";
import { euros, prettyDate, today } from "@/lib/format";
import { t } from "@/lib/language";
import { supabase } from "@/lib/supabase";

type Card = { id: string; card: string; account_id: string | null };
type Capture = {
  id: string;
  date: string;
  amount: number | string;
  merchant: string | null;
  card: string | null;
  status: "open" | "matched" | "unmapped" | "foreign";
  movement_id: string | null;
  bank: { date: string } | null;
};
type Data = {
  tokens: { id: string; last_used_at: string | null }[];
  cards: Card[];
  accounts: Account[];
  captures: Capture[];
  error: string;
};

async function fetchData(): Promise<Data> {
  const [tokens, cards, captures, accounts] = await Promise.all([
    supabase.from("capture_tokens").select("id, last_used_at"),
    supabase.from("capture_cards").select("id, card, account_id").order("created_at"),
    supabase
      .from("captures")
      .select("id, date, amount, merchant, card, status, movement_id, bank:bank_transactions(date)")
      .order("created_at", { ascending: false })
      .limit(40),
    fetchAccounts(),
  ]);
  const failure = tokens.error || cards.error || captures.error;
  return {
    tokens: tokens.data ?? [],
    cards: (cards.data ?? []) as Card[],
    captures: (captures.data ?? []) as unknown as Capture[],
    accounts: accounts.accounts,
    error: failure ? failure.message : accounts.error,
  };
}

const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `mf_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export default function CaptureSettings() {
  const [data, setData] = useState<Data | null>(null);
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState("");
  const [message, setMessage] = useState("");

  const show = useCallback((d: Data) => setData(d), []);
  const reload = useCallback(() => {
    fetchData().then(show);
  }, [show]);
  useEffect(() => {
    fetchData().then(show);
  }, [show]);

  if (DEMO) {
    return (
      <Collapsible title={t("⚡ Captura instantánea (iPhone)", "⚡ Instant capture (iPhone)")}>
        <p className="text-sm text-muted">
          {t(
            "No disponible en la demo: necesita un atajo en tu iPhone que envíe tus pagos.",
            "Not available in the demo: it needs a shortcut on your iPhone that sends your payments.",
          )}
        </p>
      </Collapsible>
    );
  }

  async function createToken() {
    setMessage("");
    const value = newToken();
    // Only a hash is stored: the token is shown now and never again
    await supabase.from("capture_tokens").delete().not("id", "is", null);
    const { error } = await supabase
      .from("capture_tokens")
      .insert({ token_hash: await sha256Hex(value) });
    if (error) return setMessage(error.message);
    setToken(value);
    reload();
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setMessage(t("No se pudo copiar: selecciónalo a mano", "Couldn't copy: select it by hand"));
    }
  }

  async function assign(card: Card, accountId: string) {
    setMessage("");
    const { error } = await supabase
      .from("capture_cards")
      .update({ account_id: accountId || null })
      .eq("id", card.id);
    if (error) return setMessage(error.message);
    try {
      await callApi("/api/capture/resolve", "POST");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
    reload();
  }

  async function remove(c: Capture) {
    // The expense the shortcut recorded goes too (a declined payment, for example)
    if (c.movement_id) await supabase.from("movements").delete().eq("id", c.movement_id);
    await supabase.from("captures").delete().eq("id", c.id);
    reload();
  }

  const endpoint = typeof window === "undefined" ? "" : `${window.location.origin}/api/capture`;
  const todayText = today();
  const lag = data
    ? lagSummary(
        data.captures
          .filter((c) => c.status === "matched" && c.bank)
          .map((c) => daysBetween(c.date, (c.bank as { date: string }).date)),
      )
    : null;
  const unmapped = data?.cards.filter((c) => !c.account_id) ?? [];

  return (
    <Collapsible title={t("⚡ Captura instantánea (iPhone)", "⚡ Instant capture (iPhone)")}>
      <p className="text-sm text-muted">
        {t(
          "Un atajo de tu iPhone envía cada pago con Apple Pay en el momento. El banco lo trae días después y la app lo empareja sin duplicarlo.",
          "A shortcut on your iPhone sends every Apple Pay payment the moment it happens. The bank brings it days later and the app pairs it without duplicating it.",
        )}
      </p>
      {data?.error && <p className="text-sm text-down">{data.error}</p>}
      {message && <p className="text-sm text-down">{message}</p>}

      {/* 1. The secret the shortcut sends */}
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("1. Clave del atajo", "1. Shortcut key")}</h3>
        {token ? (
          <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3 text-sm">
            <p className="font-semibold text-orange-500">
              {t(
                "Cópiala ahora: no se vuelve a mostrar.",
                "Copy it now: it won't be shown again.",
              )}
            </p>
            <code className="break-all text-xs">{token}</code>
            <button type="button" className="chip card self-start" onClick={() => copy("token", token)}>
              {copied === "token" ? t("¡Copiada!", "Copied!") : t("Copiar clave", "Copy key")}
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted">
            {data?.tokens.length
              ? `${t("Hay una clave activa", "There is an active key")}${
                  data.tokens[0].last_used_at
                    ? ` · ${t("último uso", "last used")} ${prettyDate(data.tokens[0].last_used_at.slice(0, 10))}`
                    : ` · ${t("sin usar todavía", "not used yet")}`
                }`
              : t("Todavía no hay clave.", "No key yet.")}
          </p>
        )}
        <button type="button" className="chip card self-start" onClick={createToken}>
          {data?.tokens.length
            ? t("Crear una clave nueva (anula la anterior)", "Create a new key (cancels the old one)")
            : t("Crear clave", "Create key")}
        </button>
        <p className="text-xs text-muted">
          {t("Dirección a la que envía el atajo:", "Address the shortcut sends to:")}{" "}
          <button type="button" className="underline" onClick={() => copy("url", endpoint)}>
            {copied === "url" ? t("¡Copiada!", "Copied!") : endpoint}
          </button>
        </p>
      </section>

      {/* 2. Which account each card belongs to */}
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("2. Tarjetas y cuentas", "2. Cards and accounts")}</h3>
        {(data?.cards.length ?? 0) === 0 ? (
          <p className="text-sm text-muted">
            {t(
              "Las tarjetas aparecen aquí solas cuando el atajo envía el primer pago.",
              "Cards show up here by themselves when the shortcut sends the first payment.",
            )}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data?.cards.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.card}</span>
                <select
                  value={c.account_id ?? ""}
                  onChange={(e) => assign(c, e.target.value)}
                  className="max-w-[55%] rounded-lg border border-line bg-surface p-2 text-base"
                  aria-label={`${t("Cuenta de", "Account of")} ${c.card}`}
                >
                  <option value="">{t("— elige cuenta —", "— choose account —")}</option>
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
        {unmapped.length > 0 && (
          <p className="text-sm text-orange-500">
            {t(
              "⚠️ Hay tarjetas sin cuenta: sus pagos esperan hasta que elijas una.",
              "⚠️ Some cards have no account: their payments wait until you choose one.",
            )}
          </p>
        )}
      </section>

      {/* 3. What arrived, and how late the bank is */}
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{t("3. Últimos pagos recibidos", "3. Latest payments received")}</h3>
        {lag && (
          <p className="text-sm text-muted">
            {t(
              `El banco tarda normalmente ${lag.typical} día(s) y como mucho ${lag.longest} (de ${lag.count} pagos emparejados).`,
              `The bank usually takes ${lag.typical} day(s) and at most ${lag.longest} (out of ${lag.count} paired payments).`,
            )}
          </p>
        )}
        {(data?.captures.length ?? 0) === 0 ? (
          <p className="text-sm text-muted">{t("Aún no ha llegado ningún pago.", "No payment has arrived yet.")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {data?.captures.map((c) => {
              const missing = c.status === "open" && isMissing(c.date, todayText);
              return (
                <li key={c.id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.merchant ?? t("(sin nombre)", "(no name)")}</p>
                    <p className="text-xs text-muted">
                      {prettyDate(c.date)} ·{" "}
                      {c.status === "matched"
                        ? t("✅ visto en el banco", "✅ seen at the bank")
                        : c.status === "unmapped"
                          ? t("⏸ falta asignar la tarjeta", "⏸ card needs an account")
                          : c.status === "foreign"
                            ? t("💱 otra moneda: apúntalo a mano", "💱 other currency: record it by hand")
                            : missing
                              ? t("⚠️ el banco no lo muestra", "⚠️ the bank doesn't show it")
                              : t("⏳ esperando al banco", "⏳ waiting for the bank")}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold">{euros(Number(c.amount))}</span>
                  <button
                    type="button"
                    onClick={() => remove(c)}
                    aria-label={t("Quitar", "Remove")}
                    className="shrink-0 px-2 text-muted"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Collapsible>
  );
}
