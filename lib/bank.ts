// Bank transactions (Enable Banking): from what the bank sends to the inbox rows.
// Pure functions, no network or database.
import type { Language } from "@/lib/language";

// What we care about in each transaction the bank sends
export type BankTransaction = {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: { amount: string | number; currency?: string | null };
  credit_debit_indicator?: string | null; // "CRDT" = money in; "DBIT" = money out
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  remittance_information?: string[] | null;
  creditor?: { name?: string | null } | null;
  debtor?: { name?: string | null } | null;
  note?: string | null;
  status?: string | null; // "BOOK" booked, "PDNG" pending, "HOLD" held...
};

// A row of the movimientos_banco table (without the account or the user)
export type BankRow = {
  bank_ref: string;
  date: string;
  amount: number; // signed: negative = money out
  currency: string;
  description: string | null;
  counterparty: string | null;
  // The bank's other dates (when it has them): only used to measure how late the bank is
  value_date?: string | null;
  transaction_date?: string | null;
};

// Collapses repeated spaces and trims the ends ("" -> null)
function clean(text: string | null | undefined): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

// "noDate": the date used if the bank sends none (happens with some held transactions)
export function convertTransactions(transactions: BankTransaction[], noDate?: string): BankRow[] {
  const seen = new Map<string, number>(); // for transactions without a bank reference
  const rows: BankRow[] = [];

  for (const t of transactions) {
    const date = t.booking_date ?? t.value_date ?? t.transaction_date ?? noDate;
    const quantity = Math.abs(Number(t.transaction_amount?.amount));
    if (!date || !Number.isFinite(quantity)) continue;

    const outgoing = t.credit_debit_indicator === "DBIT";
    const amount = (Math.round(quantity * 100) / 100) * (outgoing ? -1 : 1);
    const description = clean((t.remittance_information ?? []).join(" ")) ?? clean(t.note);
    const counterparty = clean(outgoing ? t.creditor?.name : t.debtor?.name);

    // The bank's identifier; if it doesn't send one, a "fingerprint" with the date, the amount,
    // the description and how many identical ones there are that day (so two equal coffees aren't merged)
    let id = t.entry_reference
      ? `r:${t.entry_reference}`
      : t.transaction_id
        ? `t:${t.transaction_id}`
        : "";
    if (!id) {
      const base = `${date}|${amount.toFixed(2)}|${description ?? ""}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      id = `h:${base}|${n}`;
    }

    rows.push({
      bank_ref: id,
      date: date.slice(0, 10),
      amount,
      currency: t.transaction_amount?.currency ?? "EUR",
      description,
      counterparty,
      value_date: t.value_date?.slice(0, 10) ?? null,
      transaction_date: t.transaction_date?.slice(0, 10) ?? null,
    });
  }
  return rows;
}

// A transaction that was already saved in the inbox
export type SavedRow = {
  bank_ref: string;
  date: string;
  amount: number | string;
  description: string | null;
  counterparty: string | null;
};

// Which downloaded transactions are really new.
// The id_banco isn't enough: Santander numbers each day's transactions ("2026-10-13.0",
// ".1"…) and that numbering changes from one download to the next (and sometimes isn't sent). So
// we count each day's transactions with the same amount: only what's left over is new
// compared with what's already saved. First we pair those with the same id and text, then
// those with the same text and then the rest (the bank sometimes changes the text).
// "savedRows" must bring EVERYTHING saved since the oldest downloaded day.
// If a new transaction brings an id_banco that's already used, it gets another one so it isn't lost.
export function filterNew(downloaded: BankRow[], savedRows: SavedRow[]): BankRow[] {
  const group = (f: { date: string; amount: number | string }) =>
    `${f.date.slice(0, 10)}|${Math.round(Number(f.amount) * 100)}`;
  const text = (f: { description: string | null; counterparty: string | null }) =>
    `${f.description ?? ""}|${f.counterparty ?? ""}`.toLowerCase();

  const free = new Map<string, SavedRow[]>(); // the saved ones not yet paired
  for (const g of savedRows) free.set(group(g), [...(free.get(group(g)) ?? []), g]);

  const passes: ((d: BankRow, g: SavedRow) => boolean)[] = [
    (d, g) => d.bank_ref === g.bank_ref && text(d) === text(g),
    (d, g) => text(d) === text(g),
    () => true,
  ];
  let remaining = downloaded;
  for (const same of passes) {
    remaining = remaining.filter((d) => {
      const list = free.get(group(d)) ?? [];
      const i = list.findIndex((g) => same(d, g));
      if (i < 0) return true;
      list.splice(i, 1);
      return false;
    });
  }

  const used = new Set(savedRows.map((g) => g.bank_ref));
  return downloaded
    .filter((d) => remaining.includes(d))
    .map((d) => {
      let id = d.bank_ref;
      for (let n = 2; used.has(id); n++) id = `${d.bank_ref}~${n}`;
      used.add(id);
      return id === d.bank_ref ? d : { ...d, bank_ref: id };
    });
}

// How long we ask for the permission: the most the bank allows, at most 180 days,
// with one hour of margin
export function permissionUntil(maxSeconds: number | null | undefined, now: Date): string {
  const days180 = 180 * 24 * 3600;
  const seconds = Math.min(maxSeconds && maxSeconds > 0 ? maxSeconds : days180, days180);
  return new Date(now.getTime() + (seconds - 3600) * 1000).toISOString();
}

// From which day we ask for transactions: 7 days before the last saved one (in case the bank
// books something late) or, the first time, the last 90 days
export function downloadFrom(lastDate: string | null, today: string): string {
  const base = new Date(`${lastDate ?? today}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() - (lastDate ? 7 : 90));
  return base.toISOString().slice(0, 10);
}

// The app only handles euros. With no currency, euros are assumed.
export function inEuros(currency: string | null | undefined): boolean {
  return !currency || currency.trim().toUpperCase() === "EUR";
}

// What the bank hasn't booked yet: "PDNG" (pending) and "HOLD" (held, like a card payment
// that hasn't been charged yet)
export const PENDING_STATUSES = ["PDNG", "HOLD"] as const;

// An account balance, as the bank sends it
export type BankBalance = {
  balance_amount: { amount: string | number; currency?: string | null };
  balance_type?: string | null;
  reference_date?: string | null;
  last_change_date_time?: string | null;
};

export type ChosenBalance = { amount: number; type: string; date: string | null };

// Banks send several balances. We prefer the booked one (what's already booked), which is what
// the app has; otherwise, the expected or the available one
const PREFERENCE = ["ITBD", "CLBD", "XPCD", "ITAV", "CLAV"];

export const BALANCE_NAMES: Record<string, string> = {
  ITBD: "saldo contable",
  CLBD: "saldo contable al cierre",
  XPCD: "saldo previsto",
  ITAV: "saldo disponible",
  CLAV: "saldo disponible al cierre",
};

export const BALANCE_NAMES_EN: Record<string, string> = {
  ITBD: "booked balance",
  CLBD: "closing booked balance",
  XPCD: "expected balance",
  ITAV: "available balance",
  CLAV: "closing available balance",
};

export function chooseBalance(balances: BankBalance[]): ChosenBalance | null {
  const rank = (s: BankBalance) => {
    const i = PREFERENCE.indexOf(s.balance_type ?? "");
    return i < 0 ? PREFERENCE.length : i;
  };
  const s = balances
    .filter((x) => Number.isFinite(Number(x.balance_amount?.amount)))
    .sort((a, b) => rank(a) - rank(b))[0];
  if (!s) return null;
  return {
    amount: Math.round(Number(s.balance_amount.amount) * 100) / 100,
    type: s.balance_type ?? "",
    date: (s.reference_date ?? s.last_change_date_time ?? null)?.slice(0, 10) ?? null,
  };
}

export type Comparison = {
  accountId: string;
  bank: number; // what the bank says (adding up its accounts, if several map to the same one)
  app: number; // the balance in the app
  pending: number; // what's waiting in the inbox (the bank already counts it, the app doesn't yet)
  difference: number; // bank - app - pending: what would need adjusting
};

// Compares, for each app account, the bank balance with the app balance
export function compareBalances(
  bank: { accountId: string | null; amount: number }[],
  app: Map<string, number>,
  pendingRows: { accountId: string | null; amount: number | string }[],
): Comparison[] {
  const c = (n: number) => Math.round(n * 100) / 100 || 0; // no "-0"
  const byAccount = new Map<string, number>();
  for (const b of bank) {
    if (b.accountId) byAccount.set(b.accountId, (byAccount.get(b.accountId) ?? 0) + b.amount);
  }
  return [...byAccount].map(([accountId, bankBalance]) => {
    const pending = pendingRows
      .filter((p) => p.accountId === accountId)
      .reduce((s, p) => s + Number(p.amount), 0);
    const inApp = app.get(accountId) ?? 0;
    return {
      accountId,
      bank: c(bankBalance),
      app: c(inApp),
      pending: c(pending),
      difference: c(bankBalance - inApp - pending),
    };
  });
}

// Warnings for bank permissions that expire soon (or have already expired)
export function permissionWarnings(
  connections: { bank: string; valid_until: string | null }[],
  now: number,
  marginDays = 15,
  language: Language = "es",
): string[] {
  const en = language === "en";
  const warnings: string[] = [];
  for (const connection of connections) {
    if (!connection.valid_until) continue;
    const days = Math.floor((new Date(connection.valid_until).getTime() - now) / 86400000);
    const [a, m, d] = connection.valid_until.slice(0, 10).split("-");
    if (days < 0)
      warnings.push(
        en
          ? `⚠️ The ${connection.bank} permission has expired: connect it again in Settings → 🏦 Banks`
          : `⚠️ El permiso de ${connection.bank} ha caducado: vuelve a conectarlo en Ajustes → 🏦 Bancos`,
      );
    else if (days < marginDays)
      warnings.push(
        en
          ? `⚠️ The ${connection.bank} permission expires ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`} (${d}/${m}/${a}): renew it in Settings → 🏦 Banks`
          : `⚠️ El permiso de ${connection.bank} caduca ${days === 0 ? "hoy" : days === 1 ? "mañana" : `en ${days} días`} (${d}/${m}/${a}): renuévalo en Ajustes → 🏦 Bancos`,
      );
  }
  return warnings;
}
