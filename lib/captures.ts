// Instant expense capture (iPhone shortcut): reading what the shortcut sends and pairing each
// captured expense with the bank movement that shows up days later.
// Pure functions, no network or database.

// How far the bank's date can be from the day you paid: the bank may book a Friday night
// payment on Monday or Tuesday (or later with a holiday), and a payment just after midnight
// can land on the day before
export const DAYS_BEFORE = 1;
export const DAYS_AFTER = 7;
// A captured expense the bank hasn't shown after this many days is flagged
export const MISSING_AFTER_DAYS = 10;

// "12,50 €", "12.5", "1.234,56", "$1,234.50" -> a positive number with 2 decimals (or null)
export function parseCaptureAmount(input: unknown): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) && input !== 0 ? Math.round(Math.abs(input) * 100) / 100 : null;
  }
  if (typeof input !== "string") return null;
  let text = input.replace(/[^\d.,-]/g, "").replace(/^-/, "").replace(/-/g, "");
  if (!/\d/.test(text)) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Both appear: the last one is the decimal separator
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    text = text.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = text.split(sep);
    // "1,234" or "1.234.567" are thousands; "12,5" and "12.50" are decimals
    const thousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== "0");
    text = thousands ? parts.join("") : parts.join(".");
  }
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// Is it euros? The shortcut may send nothing, "EUR" or "€"
export function isEuro(currency: unknown): boolean {
  if (currency === undefined || currency === null || currency === "") return true;
  return typeof currency === "string" && /^(eur|euro|euros|€)$/i.test(currency.trim());
}

// Card names are compared ignoring case and repeated spaces
export function normalizeCard(card: unknown): string {
  return typeof card === "string" ? card.replace(/\s+/g, " ").trim().toLowerCase() : "";
}

export function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime() -
      new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime()) /
      86400000,
  );
}

export type CaptureLike = { id: string; date: string; amount: number | string; merchant: string | null };
// Bank movement: signed amount (negative = money out)
export type BankLike = {
  id: string;
  date: string;
  amount: number | string;
  description: string | null;
  counterparty: string | null;
};

const cents = (n: number | string) => Math.round(Number(n) * 100);

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ");

// Do the merchant the shortcut saw and the bank's text share a word of 3+ letters?
export function looksSame(merchant: string | null, bank: BankLike): boolean {
  if (!merchant) return false;
  const text = ` ${norm(`${bank.description ?? ""} ${bank.counterparty ?? ""}`)} `;
  return norm(merchant)
    .split(" ")
    .filter((w) => w.length >= 3)
    .some((w) => text.includes(` ${w}`) || text.includes(w));
}

// Pairs each captured expense with a bank movement: same amount to the cent, money going out,
// and a bank date from DAYS_BEFORE days before to DAYS_AFTER days after the day you paid.
// Each one is used once. First the ones whose text looks alike (closest in time first); then the
// rest in the order you paid, each taking the earliest bank row that fits (banks book in order).
// Returns captureId -> bankId.
export function pairCaptures(captures: CaptureLike[], bank: BankLike[]): Map<string, string> {
  const penalty = (d: number) => (d < 0 ? -d + 0.5 : d); // a bank date before the payment is less likely
  const fits = (c: CaptureLike, b: BankLike) => {
    if (Number(b.amount) >= 0 || cents(c.amount) !== -cents(b.amount)) return null;
    const delta = daysBetween(c.date, b.date);
    return delta < -DAYS_BEFORE || delta > DAYS_AFTER ? null : delta;
  };
  const pairs = new Map<string, string>();
  const usedBank = new Set<string>();

  const alike: { c: CaptureLike; b: BankLike; delta: number }[] = [];
  for (const c of captures) {
    for (const b of bank) {
      const delta = fits(c, b);
      if (delta !== null && looksSame(c.merchant, b)) alike.push({ c, b, delta });
    }
  }
  alike.sort(
    (x, y) =>
      penalty(x.delta) - penalty(y.delta) ||
      x.c.id.localeCompare(y.c.id) ||
      x.b.id.localeCompare(y.b.id),
  );
  for (const { c, b } of alike) {
    if (pairs.has(c.id) || usedBank.has(b.id)) continue;
    pairs.set(c.id, b.id);
    usedBank.add(b.id);
  }

  const rest = captures
    .filter((c) => !pairs.has(c.id))
    .sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
  for (const c of rest) {
    let best: { b: BankLike; score: number } | null = null;
    for (const b of bank) {
      if (usedBank.has(b.id)) continue;
      const delta = fits(c, b);
      if (delta === null) continue;
      const score = penalty(delta);
      if (!best || score < best.score || (score === best.score && b.id.localeCompare(best.b.id) < 0)) {
        best = { b, score };
      }
    }
    if (best) {
      pairs.set(c.id, best.b.id);
      usedBank.add(best.b.id);
    }
  }
  return pairs;
}

// Open captured expenses the bank still hasn't shown
export function isMissing(captureDate: string, todayDate: string): boolean {
  return daysBetween(captureDate, todayDate) > MISSING_AFTER_DAYS;
}

// Days the bank took, from the pairs already matched: typical (median) and the longest
export function lagSummary(days: number[]): { count: number; typical: number; longest: number } | null {
  if (days.length === 0) return null;
  const sorted = [...days].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const typical = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { count: sorted.length, typical, longest: sorted[sorted.length - 1] };
}
