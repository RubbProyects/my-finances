// Server side of the instant expense capture: saving what the iPhone shortcut sends and
// pairing it with the bank movement that arrives later. ONLY on the server.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findRule, movementRow, normalize, type Rule } from "@/lib/classify";
import { normalizeCard, pairCaptures } from "@/lib/captures";

export type CaptureRow = {
  id: string;
  date: string;
  amount: number | string;
  merchant: string | null;
  card: string | null;
  status: "open" | "matched" | "unmapped" | "foreign";
  account_id: string | null;
  movement_id: string | null;
};

// First item of the list the shortcut shows: keeps the category the rules chose
export const AUTO_CATEGORY = "⚡ Automática";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// The user a shortcut token belongs to (null if it isn't valid)
export async function userForToken(admin: SupabaseClient, token: string): Promise<string | null> {
  if (token.length < 20) return null;
  const { data } = await admin
    .from("capture_tokens")
    .select("id, user_id")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data) return null;
  await admin
    .from("capture_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);
  return data.user_id as string;
}

// The app account a card belongs to (null if the card is new or still unassigned).
// A new card is saved so it shows up in Settings to be assigned.
export async function accountForCard(
  admin: SupabaseClient,
  userId: string,
  card: string,
): Promise<string | null> {
  const { data } = await admin.from("capture_cards").select("id, card, account_id").eq("user_id", userId);
  const known = (data ?? []).find((c) => normalizeCard(c.card) === normalizeCard(card));
  if (known) return (known.account_id as string | null) ?? null;
  if (card) await admin.from("capture_cards").insert({ user_id: userId, card });
  return null;
}

// The list the shortcut offers: automatic first, then your expense categories, the most used
// (in your latest expenses) first
export async function categoryChoices(admin: SupabaseClient, userId: string): Promise<string[]> {
  const [{ data: cats }, { data: recent }] = await Promise.all([
    admin.from("expense_categories").select("id, name").eq("user_id", userId),
    admin
      .from("movements")
      .select("category_id")
      .eq("user_id", userId)
      .eq("type", "expense")
      .not("category_id", "is", null)
      .order("date", { ascending: false })
      .limit(300),
  ]);
  const uses = new Map<string, number>();
  for (const r of recent ?? []) uses.set(r.category_id, (uses.get(r.category_id) ?? 0) + 1);
  const names = (cats ?? [])
    .map((c) => ({ name: c.name as string, n: uses.get(c.id) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .map((c) => c.name);
  return [AUTO_CATEGORY, ...names];
}

// The id of the expense category with that name (ignoring case and accents), or null
export async function categoryIdByName(
  admin: SupabaseClient,
  userId: string,
  name: string,
): Promise<string | null> {
  if (!name || name === AUTO_CATEGORY) return null;
  const { data } = await admin.from("expense_categories").select("id, name").eq("user_id", userId);
  return (data ?? []).find((c) => normalize(c.name) === normalize(name))?.id ?? null;
}

// Records the expense in the app right away (with the category a rule suggests, if any;
// "categoryId" is the one chosen on the shortcut and wins over the rule)
// and marks the capture as waiting for the bank
export async function recordCapture(
  admin: SupabaseClient,
  userId: string,
  c: CaptureRow,
  accountId: string,
  categoryId: string | null = null,
): Promise<string | null> {
  const { data: rules } = await admin.from("bank_rules").select("*").eq("user_id", userId);
  const asMovement = {
    id: c.id,
    date: c.date,
    amount: -Number(c.amount),
    description: c.merchant,
    counterparty: null,
  };
  // A card payment is never a transfer between your accounts
  const rule = findRule(((rules ?? []) as Rule[]).filter((r) => !r.is_transfer), asMovement, accountId);
  const built = movementRow(asMovement, accountId, {
    isTransfer: false,
    categoryId: categoryId ?? rule?.category_id ?? null,
    bizum: rule?.bizum ?? false,
    otherAccountId: null,
    description: rule?.description ?? c.merchant ?? "",
  });
  if ("error" in built) return built.error;
  const { data: movement, error } = await admin
    .from("movements")
    .insert({ ...built.row, user_id: userId })
    .select("id")
    .single();
  if (error || !movement) return error?.message ?? "Couldn't save the expense";
  const { error: e2 } = await admin
    .from("captures")
    .update({ status: "open", account_id: accountId, movement_id: movement.id })
    .eq("id", c.id)
    .eq("user_id", userId);
  if (e2) {
    // It couldn't be marked: it's undone so there's no orphan expense
    await admin.from("movements").delete().eq("id", movement.id).eq("user_id", userId);
    return e2.message;
  }
  return null;
}

// Captures that were waiting for their card to be assigned to an account: now they're recorded
export async function resolveUnmapped(admin: SupabaseClient, userId: string): Promise<number> {
  const [{ data: cards }, { data: waiting }] = await Promise.all([
    admin.from("capture_cards").select("card, account_id").eq("user_id", userId).not("account_id", "is", null),
    admin.from("captures").select("*").eq("user_id", userId).eq("status", "unmapped").order("date"),
  ]);
  let done = 0;
  for (const c of (waiting ?? []) as CaptureRow[]) {
    const card = (cards ?? []).find((k) => normalizeCard(k.card) === normalizeCard(c.card));
    if (!card?.account_id) continue;
    if (!(await recordCapture(admin, userId, c, card.account_id as string))) done++;
  }
  return done;
}

// Pairs the waiting captures with the bank movements still in the inbox. A paired movement is
// marked as linked to the expense the shortcut already recorded, so nothing is duplicated.
export async function reconcileCaptures(
  admin: SupabaseClient,
  userId: string,
): Promise<{ matched: number; bankIds: Set<string> }> {
  const none = { matched: 0, bankIds: new Set<string>() };
  const { data: open } = await admin
    .from("captures")
    .select("id, date, amount, merchant, account_id, movement_id")
    .eq("user_id", userId)
    .eq("status", "open")
    .not("account_id", "is", null)
    .not("movement_id", "is", null);
  if (!open || open.length === 0) return none;

  const { data: bankAccounts } = await admin
    .from("bank_accounts")
    .select("id, account_id")
    .eq("user_id", userId)
    .not("account_id", "is", null);
  const appAccountOf = new Map((bankAccounts ?? []).map((b) => [b.id as string, b.account_id as string]));
  if (appAccountOf.size === 0) return none;

  const oldest = open.reduce((min, c) => (c.date < min ? c.date : min), open[0].date);
  const { data: inbox, error } = await admin
    .from("bank_transactions")
    .select("id, date, amount, description, counterparty, bank_account_id")
    .eq("user_id", userId)
    .eq("status", "pending")
    .is("movement_id", null)
    .in("bank_account_id", [...appAccountOf.keys()])
    .gte("date", oldest.slice(0, 10))
    .limit(1000);
  if (error || !inbox || inbox.length === 0) return none;

  const result = { matched: 0, bankIds: new Set<string>() };
  const byAccount = new Map<string, typeof open>();
  for (const c of open) byAccount.set(c.account_id, [...(byAccount.get(c.account_id) ?? []), c]);

  for (const [accountId, captures] of byAccount) {
    const rows = inbox.filter((r) => appAccountOf.get(r.bank_account_id) === accountId);
    for (const [captureId, bankId] of pairCaptures(captures, rows)) {
      const capture = captures.find((c) => c.id === captureId);
      if (!capture) continue;
      const { data: marked } = await admin
        .from("bank_transactions")
        .update({ status: "classified", movement_id: capture.movement_id, auto: "linked" })
        .eq("id", bankId)
        .eq("user_id", userId)
        .eq("status", "pending")
        .select("id");
      if (!marked?.length) continue;
      await admin
        .from("captures")
        .update({ status: "matched", bank_transaction_id: bankId })
        .eq("id", captureId)
        .eq("user_id", userId);
      result.matched++;
      result.bankIds.add(bankId);
    }
  }
  return result;
}
