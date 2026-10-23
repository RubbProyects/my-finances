// Downloads the bank accounts' transactions and saves them in the inbox (movimientos_banco).
// ONLY on the server. Those already there aren't touched (see filterNew in lib/bank.ts).
// New ones that match a rule are recorded automatically (see autoPlan in lib/classify.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  convertTransactions,
  downloadFrom,
  chooseBalance,
  inEuros,
  PENDING_STATUSES,
  filterNew,
  type BankRow,
  type SavedRow,
  type BankBalance,
  type ChosenBalance,
  type BankTransaction,
} from "@/lib/bank";
import { reconcileCaptures } from "@/lib/capture-server";
import { linkKey, autoPlan, type AppMovement, type BankMovement, type Rule } from "@/lib/classify";
import { BankError, callBank } from "@/lib/enable-banking";
import { today } from "@/lib/format";

export type AccountResult = {
  account: string;
  added: number;
  pending: BankRow[]; // the ones the bank hasn't booked yet (not saved)
  latest: string | null; // date of the last booked transaction the bank returned
  notes: string[]; // warnings that aren't errors
  skipped: boolean; // account that isn't read (not in euros)
  error: string | null;
};

// What was recorded automatically by the rules
export type AutoResult = { recorded: number; linked: number; error: string | null };

export type FetchResult = { results: AccountResult[]; auto: AutoResult };

// A transaction just saved in the inbox
type NewRow = BankMovement & { bank_account_id: string };

type AccountWithConnection = {
  id: string;
  user_id: string;
  uid: string;
  account_id: string | null;
  name: string | null;
  iban_last4: string | null;
  currency: string | null;
  connection: { id: string; bank: string; status: string; valid_until: string | null } | null;
};

// The user's bank accounts with an active permission
async function activeAccounts(
  admin: SupabaseClient,
  userId: string,
): Promise<AccountWithConnection[]> {
  const { data, error } = await admin
    .from("bank_accounts")
    .select(
      "id, user_id, uid, account_id, name, iban_last4, currency, connection:bank_connections!inner(id, bank, status, valid_until)",
    )
    .eq("user_id", userId)
    .eq("connection.status", "active");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AccountWithConnection[];
}

const accountName = (c: AccountWithConnection) =>
  `${c.connection?.bank ?? "Bank"} · ${c.name ?? "account"}${c.iban_last4 ? ` ···${c.iban_last4}` : ""}`;

const expired = (c: AccountWithConnection) =>
  Boolean(c.connection?.valid_until && new Date(c.connection.valid_until) < new Date());

// Explains a bank failure ("the permission expired" is said clearly)
function errorReason(e: unknown): string {
  const reason = e instanceof Error ? e.message : String(e);
  return e instanceof BankError && (e.status === 401 || e.status === 403)
    ? `The bank won't let us read the account (${reason}). Try connecting it again`
    : reason;
}

export type AccountBalance = {
  id: string; // the bank account
  account: string; // its name
  accountId: string | null; // the app account
  balance: ChosenBalance | null;
  error: string | null;
};

// The balance the bank reports for each account (to compare it with the app's)
export async function bankBalances(
  admin: SupabaseClient,
  userId: string,
  headers: Record<string, string> = {},
): Promise<AccountBalance[]> {
  const balances: AccountBalance[] = [];
  for (const c of await activeAccounts(admin, userId)) {
    if (!inEuros(c.currency)) continue; // the app only handles euros
    const row = { id: c.id, account: accountName(c), accountId: c.account_id };
    if (expired(c)) {
      balances.push({
        ...row,
        balance: null,
        error: "The permission has expired: connect the bank again",
      });
      continue;
    }
    try {
      const r = await callBank<{ balances?: BankBalance[] }>(
        `/accounts/${encodeURIComponent(c.uid)}/balances`,
        { headers },
      );
      const balance = chooseBalance(r.balances ?? []);
      balances.push({
        ...row,
        balance,
        error: balance ? null : "The bank didn't return any balance",
      });
    } catch (e) {
      balances.push({ ...row, balance: null, error: errorReason(e) });
    }
  }
  return balances;
}

export async function fetchMovements(
  admin: SupabaseClient,
  userId: string,
  headers: Record<string, string> = {},
): Promise<FetchResult> {
  const accounts = await activeAccounts(admin, userId);
  const results: AccountResult[] = [];
  const usedConnections = new Set<string>();
  const newOnes: NewRow[] = [];

  for (const c of accounts) {
    const name = accountName(c);
    const empty = { account: name, added: 0, pending: [], latest: null, notes: [] };
    if (!inEuros(c.currency)) {
      // The app only handles euros: it isn't downloaded, and what arrived before is removed from the inbox
      await admin
        .from("bank_transactions")
        .update({ status: "ignored" })
        .eq("bank_account_id", c.id)
        .eq("status", "pending");
      results.push({
        ...empty,
        notes: [`💱 It's in ${c.currency}: not read (the app only handles euros)`],
        skipped: true,
        error: null,
      });
      continue;
    }
    if (expired(c)) {
      results.push({
        ...empty,
        skipped: false,
        error: "The permission has expired: connect the bank again in Settings",
      });
      continue;
    }
    try {
      const r = await fetchAccount(admin, c, headers);
      newOnes.push(...r.rows);
      results.push({
        account: name,
        added: r.rows.length,
        pending: r.pending,
        latest: r.latest,
        notes: r.notes,
        skipped: false,
        error: null,
      });
      if (c.connection) usedConnections.add(c.connection.id);
    } catch (e) {
      results.push({ ...empty, skipped: false, error: errorReason(e) });
    }
  }

  if (usedConnections.size > 0) {
    await admin
      .from("bank_connections")
      .update({ last_fetch_at: new Date().toISOString() })
      .in("id", [...usedConnections]);
  }

  // Expenses the iPhone shortcut already recorded are paired with their bank movement first,
  // so they are linked instead of being recorded again
  let paired = 0;
  let waiting = newOnes;
  try {
    const r = await reconcileCaptures(admin, userId);
    paired = r.matched;
    waiting = newOnes.filter((n) => !r.bankIds.has(n.id));
  } catch {
    // If pairing fails they stay in the inbox as usual
  }

  // New items that match a rule are recorded automatically. If it fails, they stay in the inbox.
  let automatic: AutoResult = { recorded: 0, linked: paired, error: null };
  if (waiting.length > 0) {
    try {
      automatic = await autoRecord(admin, userId, accounts, waiting);
      automatic.linked += paired;
    } catch (e) {
      automatic.error = e instanceof Error ? e.message : String(e);
    }
  }
  return { results, auto: automatic };
}

// For the cron: fetches the transactions of every user with a connected bank
export async function fetchAllUsers(
  admin: SupabaseClient,
): Promise<({ user: string } & FetchResult)[]> {
  const { data, error } = await admin
    .from("bank_connections")
    .select("user_id")
    .eq("status", "active");
  if (error) throw new Error(error.message);
  const users = [...new Set((data ?? []).map((f) => f.user_id as string))];
  const all = [];
  for (const u of users) all.push({ user: u, ...(await fetchMovements(admin, u)) });
  return all;
}

// Supabase returns at most 1000 rows: fetch every page
async function fetchAll<T>(
  fetchPage: (from: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const list: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await fetchPage(i);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    list.push(...batch);
    if (batch.length < 1000) return list;
  }
}

// Automatically records new transactions that match a rule (and links the other side of
// transfers between your accounts). Anything doubtful stays in the inbox.
async function autoRecord(
  admin: SupabaseClient,
  userId: string,
  accounts: AccountWithConnection[],
  newOnes: NewRow[],
): Promise<AutoResult> {
  const accountOf = new Map(accounts.map((c) => [c.id, c.account_id]));
  const dates = newOnes.map((n) => n.date).sort();
  const from = dates[0];
  const until = dates[dates.length - 1];
  const [rules, app, linked] = await Promise.all([
    fetchAll<Rule>((i) =>
      admin
        .from("bank_rules")
        .select("*")
        .eq("user_id", userId)
        .order("id")
        .range(i, i + 999),
    ),
    fetchAll<AppMovement>((i) =>
      admin
        .from("movements")
        .select("id, date, type, amount, account_id, target_account_id, description")
        .eq("user_id", userId)
        .gte("date", from)
        .lte("date", until)
        .order("id")
        .range(i, i + 999),
    ),
    fetchAll<{ movement_id: string; bank_account_id: string }>((i) =>
      admin
        .from("bank_transactions")
        .select("movement_id, bank_account_id")
        .eq("user_id", userId)
        .not("movement_id", "is", null)
        .gte("date", from)
        .lte("date", until)
        .order("id")
        .range(i, i + 999),
    ),
  ]);
  if (rules.length === 0) return { recorded: 0, linked: 0, error: null };

  const plan = autoPlan(
    [...newOnes]
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map((m) => ({ m, accountId: accountOf.get(m.bank_account_id) ?? null })),
    rules,
    app,
    new Set(linked.map((e) => linkKey(e.movement_id, accountOf.get(e.bank_account_id) ?? null))),
  );

  const result: AutoResult = { recorded: 0, linked: 0, error: null };
  const created = new Map<string, string>(); // ref "nuevo:N" -> real id
  for (const a of plan) {
    // The bank one is marked only if it was still pending (in case you classified it at the same time)
    const mark = (movementId: string, auto: "recorded" | "linked") =>
      admin
        .from("bank_transactions")
        .update({ status: "classified", movement_id: movementId, auto })
        .eq("id", a.m.id)
        .eq("user_id", userId)
        .eq("status", "pending")
        .select("id");

    if (a.type === "enlazar") {
      const id = created.get(a.movementId) ?? a.movementId;
      if (id.startsWith("nuevo:")) continue; // its other side couldn't be recorded
      const { data, error } = await mark(id, "linked");
      if (error) result.error ??= error.message;
      else if (data?.length) result.linked++;
      continue;
    }

    const { data: newOne, error: e1 } = await admin
      .from("movements")
      .insert({ ...a.row, user_id: userId })
      .select("id")
      .single();
    if (e1 || !newOne) {
      result.error ??= e1?.message ?? "Couldn't save";
      continue;
    }
    const { data, error: e2 } = await mark(newOne.id, "recorded");
    if (e2 || !data?.length) {
      // It couldn't be marked: it's undone so there's no duplicate
      await admin.from("movements").delete().eq("id", newOne.id).eq("user_id", userId);
      if (e2) result.error ??= e2.message;
      continue;
    }
    created.set(a.ref, newOne.id);
    result.recorded++;
  }
  return result;
}

// Asks the bank for an account's transactions with that status ("BOOK" = booked,
// "PDNG" = pending, "HOLD" = held), page by page
async function fetchTransactions(
  uid: string,
  from: string,
  status: "BOOK" | (typeof PENDING_STATUSES)[number],
  headers: Record<string, string>,
): Promise<BankTransaction[]> {
  const transactions: BankTransaction[] = [];
  let keepGoing: string | null = null;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ date_from: from, transaction_status: status });
    if (keepGoing) q.set("continuation_key", keepGoing);
    const r: { transactions?: BankTransaction[]; continuation_key?: string | null } =
      await callBank(`/accounts/${encodeURIComponent(uid)}/transactions?${q}`, {
        headers,
      });
    transactions.push(...(r.transactions ?? []));
    keepGoing = r.continuation_key ?? null;
    if (!keepGoing) break;
  }
  return transactions;
}

// Downloads an account and saves what's new. Returns the new transactions, the bank's pending
// and held ones (only to show them), the date of the last booking and some warnings
async function fetchAccount(
  admin: SupabaseClient,
  c: AccountWithConnection,
  headers: Record<string, string>,
): Promise<{ rows: NewRow[]; pending: BankRow[]; latest: string | null; notes: string[] }> {
  const { data: last } = await admin
    .from("bank_transactions")
    .select("date")
    .eq("bank_account_id", c.id)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const from = downloadFrom(last?.date ?? null, today());

  // Only booked (BOOK) transactions in euros are saved: pending ones may change
  const notes: string[] = [];
  const all = convertTransactions(await fetchTransactions(c.uid, from, "BOOK", headers));
  const recorded = all.filter((f) => inEuros(f.currency));
  const otherCurrency = all.length - recorded.length;
  if (otherCurrency > 0)
    notes.push(
      `💱 ${otherCurrency} ${otherCurrency === 1 ? "transaction in another currency isn't saved" : "transactions in another currency aren't saved"}`,
    );
  const lastBooking = recorded.reduce<string | null>(
    (max, f) => (max === null || f.date > max ? f.date : max),
    last?.date ?? null,
  );

  // Pending and held ones are only shown, and only if you're there: the cron doesn't
  // ask for them, because some banks limit downloads without you. If the bank doesn't send them, it says so.
  const pendingRows: BankRow[] = [];
  if (Object.keys(headers).length > 0) {
    const seenOnes = new Set(recorded.map((f) => f.bank_ref));
    let failures = 0;
    for (const status of PENDING_STATUSES) {
      try {
        const rows = convertTransactions(
          await fetchTransactions(c.uid, from, status, headers),
          today(),
        );
        for (const f of rows) {
          if (!inEuros(f.currency) || seenOnes.has(f.bank_ref)) continue;
          seenOnes.add(f.bank_ref); // it may come as both pending and held
          pendingRows.push(f);
        }
      } catch {
        failures++;
      }
    }
    if (failures === PENDING_STATUSES.length)
      notes.push("ℹ️ The bank doesn't provide pending or held transactions");
  }

  // What's already saved since the oldest day that arrived, so it isn't saved again
  const firstDay = recorded.reduce((min, f) => (f.date < min ? f.date : min), from);
  const savedRows: SavedRow[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await admin
      .from("bank_transactions")
      .select("bank_ref, date, amount, description, counterparty")
      .eq("bank_account_id", c.id)
      .gte("date", firstDay)
      .order("id")
      .range(i, i + 999);
    if (error) throw new Error(error.message);
    savedRows.push(...((data ?? []) as SavedRow[]));
    if ((data?.length ?? 0) < 1000) break;
  }

  const rows = filterNew(recorded, savedRows).map((f) => ({
    ...f,
    user_id: c.user_id,
    bank_account_id: c.id,
  }));
  const savedOnes: NewRow[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await admin
      .from("bank_transactions")
      .upsert(rows.slice(i, i + 500), {
        onConflict: "bank_account_id,bank_ref",
        ignoreDuplicates: true,
      })
      .select("id, date, amount, description, counterparty, bank_account_id");
    if (error) throw new Error(error.message);
    savedOnes.push(...((data ?? []) as NewRow[]));
  }
  return { rows: savedOnes, pending: pendingRows, latest: lastBooking, notes };
}
