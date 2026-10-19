// Classifying bank transactions: rules, possible duplicates and the row that gets saved.
// Pure functions, no network or database.
import type { Language } from "@/lib/language";
import type { MovementType } from "@/lib/movements";

// An inbox transaction (signed amount: negative = money out)
export type BankMovement = {
  id: string;
  date: string;
  amount: number | string;
  description: string | null;
  counterparty: string | null;
};

export type Rule = {
  id: string;
  text: string; // lowercase and without accents
  category_id: string | null;
  bizum: boolean;
  is_transfer: boolean;
  other_account_id: string | null;
  description: string | null;
};

// A transaction that's already in the app
export type AppMovement = {
  id: string;
  date: string;
  type: MovementType;
  amount: number | string;
  account_id: string | null;
  target_account_id: string | null;
  description: string | null;
};

// What you choose when classifying
export type Choice = {
  isTransfer: boolean;
  categoryId: string | null;
  bizum: boolean;
  otherAccountId: string | null; // for transfers: the target (or source) account
  description: string;
  refundOfId?: string | null; // if it's a refund of an expense: that expense
};

// "Café  Martínez" -> "cafe martinez"
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const roundCents = (n: number) => Math.round(n * 100);

// The rule that matches the transaction: the one with the longest text (the most specific).
// A transfer to the same bank account isn't valid.
export function findRule(rules: Rule[], m: BankMovement, accountId: string | null): Rule | null {
  const location = normalize(`${m.description ?? ""} ${m.counterparty ?? ""}`);
  return rules
    .filter((r) => r.text && location.includes(r.text))
    .filter((r) => !r.is_transfer || (r.other_account_id && r.other_account_id !== accountId))
    .reduce<Rule | null>((best, r) => (!best || r.text.length > best.text.length ? r : best), null);
}

// The text we suggest for the rule: the merchant, or the description without "COMPRA TARJ. 1234"
export function suggestedText(m: BankMovement): string {
  if (m.counterparty) return normalize(m.counterparty);
  const withoutPrefix = normalize(m.description ?? "")
    .replace(/^(compra|pago|cargo)(\s+(con|en|de|tarj(eta)?\.?|\d+))*\s*/, "")
    .replace(/[^a-z0-9ñ ]/g, " ");
  return withoutPrefix.split(" ").filter(Boolean).slice(0, 2).join(" ");
}

// How much the account changes with an app transaction (null if it doesn't touch it)
function accountEffect(a: AppMovement, accountId: string): number | null {
  const amount = Number(a.amount);
  if (a.type === "transfer") {
    if (a.account_id === accountId) return -amount;
    if (a.target_account_id === accountId) return amount;
    return null;
  }
  if (a.account_id !== accountId) return null;
  return a.type === "expense" ? -amount : amount; // income and adjustments already carry their sign
}

// A link between the bank and the app, seen from an app account: a transfer
// between two of your accounts can be linked once from each one
export function linkKey(movementId: string, accountId: string | null): string {
  return `${movementId}|${accountId ?? ""}`;
}

// For each bank transaction, the app one that looks the same: same account, same day
// and same amount. Each app transaction is only paired once per account.
// "alreadyLinked" are linkKey keys.
export function matchDuplicates(
  inbox: { m: BankMovement; accountId: string | null }[],
  app: AppMovement[],
  alreadyLinked: Set<string>,
): Map<string, AppMovement> {
  const used = new Set(alreadyLinked);
  const pairs = new Map<string, AppMovement>();
  for (const { m, accountId } of inbox) {
    if (!accountId) continue;
    const same = app.find(
      (a) =>
        !used.has(linkKey(a.id, accountId)) &&
        a.date === m.date &&
        accountEffect(a, accountId) !== null &&
        roundCents(accountEffect(a, accountId) ?? 0) === roundCents(Number(m.amount)),
    );
    if (same) {
      used.add(linkKey(same.id, accountId));
      pairs.set(m.id, same);
    }
  }
  return pairs;
}

// What the rule suggests, ready to save
export function choiceFromRule(r: Rule, m: BankMovement): Choice {
  return {
    isTransfer: r.is_transfer,
    categoryId: r.is_transfer ? null : r.category_id,
    bizum: r.is_transfer ? false : r.bizum,
    otherAccountId: r.is_transfer ? r.other_account_id : null,
    description: r.description ?? m.counterparty ?? m.description ?? "",
  };
}

// The "movements" row that gets saved. Expense or income is decided by the bank's sign.
export function movementRow(
  m: BankMovement,
  accountId: string,
  e: Choice,
  language: Language = "es",
): { row: Record<string, unknown> } | { error: string } {
  const tx = (es: string, en: string) => (language === "en" ? en : es);
  const amount = Math.abs(Number(m.amount));
  if (!(amount > 0))
    return { error: tx("El movimiento no tiene importe", "The transaction has no amount") };
  const outgoing = Number(m.amount) < 0;
  const common = {
    date: m.date,
    amount: Math.round(amount * 100) / 100,
    description: e.description.trim() || null,
  };

  // Refund of an expense: an income with that expense's category
  if (e.refundOfId) {
    if (outgoing)
      return {
        error: tx(
          "Solo un dinero que entra puede ser un reembolso",
          "Only incoming money can be a refund",
        ),
      };
    return {
      row: {
        ...common,
        type: "income",
        account_id: accountId,
        target_account_id: null,
        category_id: e.categoryId,
        bizum: e.bizum,
        refund_of_id: e.refundOfId,
      },
    };
  }

  if (e.isTransfer) {
    if (!e.otherAccountId)
      return {
        error: outgoing
          ? tx("Elige a qué cuenta va", "Choose the account it goes to")
          : tx("Elige de qué cuenta viene", "Choose the account it comes from"),
      };
    if (e.otherAccountId === accountId)
      return {
        error: tx("La otra cuenta tiene que ser distinta", "The other account must be different"),
      };
    return {
      row: {
        ...common,
        type: "transfer",
        account_id: outgoing ? accountId : e.otherAccountId,
        target_account_id: outgoing ? e.otherAccountId : accountId,
        category_id: null,
        bizum: false,
      },
    };
  }
  return {
    row: {
      ...common,
      type: outgoing ? "expense" : "income",
      account_id: accountId,
      target_account_id: null,
      category_id: e.categoryId,
      bizum: e.bizum,
    },
  };
}

// What's done automatically with a transaction just arrived from the bank
export type Action =
  | { type: "apuntar"; m: BankMovement; ref: string; row: Record<string, unknown> }
  | { type: "enlazar"; m: BankMovement; movementId: string }; // real id or the ref of one recorded earlier

// What can be done automatically with the transactions that just arrived from the bank:
// - if it looks like one you already have in the app, it stays in the inbox for you to decide.
//   It's only linked automatically if it's a transfer between your accounts whose other side
//   already comes from the bank (e.g. the deposit into the piggy bank from a salary transfer);
// - otherwise, if it matches a rule, it's recorded with that rule;
// - everything else stays in the inbox.
// The ones recorded here count for the following ones (two equal coffees, both sides of
// a transfer). Their id doesn't exist yet: a "nuevo:N" ref is used.
export function autoPlan(
  newOnes: { m: BankMovement; accountId: string | null }[],
  rules: Rule[],
  app: AppMovement[],
  alreadyLinked: Set<string>,
): Action[] {
  const used = new Set(alreadyLinked);
  const list = [...app];
  const actions: Action[] = [];
  const done = new Set<string>();
  // Two passes: the second links the other side of the transfers recorded in the
  // first even if it arrived earlier (the piggy-bank deposit before the salary withdrawal)
  for (let pass = 0; pass < 2; pass++) {
    for (const { m, accountId } of newOnes) {
      if (!accountId || done.has(m.id)) continue;
      const action = decide(m, accountId, pass === 0);
      if (action) {
        done.add(m.id);
        actions.push(action);
      }
    }
  }
  return actions;

  function decide(m: BankMovement, accountId: string, withRules: boolean): Action | null {
    const pair = matchDuplicates([{ m, accountId }], list, used).get(m.id);
    if (pair) {
      const other = pair.account_id === accountId ? pair.target_account_id : pair.account_id;
      if (pair.type !== "transfer" || !used.has(linkKey(pair.id, other))) return null;
      used.add(linkKey(pair.id, accountId));
      return { type: "enlazar", m, movementId: pair.id };
    }
    if (!withRules) return null;
    const rule = findRule(rules, m, accountId);
    if (!rule) return null;
    const r = movementRow(m, accountId, choiceFromRule(rule, m));
    if ("error" in r) return null;
    const ref = `nuevo:${done.size}`;
    list.push({
      id: ref,
      date: m.date,
      type: r.row.type as MovementType,
      amount: r.row.amount as number,
      account_id: r.row.account_id as string | null,
      target_account_id: r.row.target_account_id as string | null,
      description: r.row.description as string | null,
    });
    used.add(linkKey(ref, accountId));
    return { type: "apuntar", m, ref, row: r.row };
  }
}
