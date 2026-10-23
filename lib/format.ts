// Shared formatting and style helpers
import { language, locale } from "@/lib/language";

export const field = "rounded border border-gray-400 bg-white p-3 text-base text-black";
export const button =
  "rounded bg-blue-600 p-3 text-base font-semibold text-white disabled:opacity-50";

// Turns what was typed into a number (or null if it isn't a number).
// In Spanish: "1.234,56", "1234,56" or "1234.56" -> 1234.56.
// In English: "1,234.56" or "1234.56" -> 1234.56; also "150,5" -> 150.5 (a comma not
// followed by 3 digits is taken as a decimal).
export function parseNumber(text: string): number | null {
  let clean = text.trim().replace(/\s|€|%/g, "");
  if (language() === "en") {
    const thousands = clean.includes(".") || /,\d{3}(?!\d)/.test(clean);
    clean = thousands ? clean.replace(/,/g, "") : clean.replace(",", ".");
  } else if (clean.includes(",")) clean = clean.replace(/\./g, "").replace(",", ".");
  const n = Number(clean);
  return clean === "" || Number.isNaN(n) ? null : n;
}

// Each format is created only once per language
const formatters = new Map<string, Intl.NumberFormat>();
function formatter(name: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale()}|${name}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale(), options);
    formatters.set(key, f);
  }
  return f;
}

// 1234.5 -> "1234,50 €" (in English, "€1,234.50")
export function euros(n: number): string {
  return formatter("euros", { style: "currency", currency: "EUR" }).format(n);
}

// Price per unit, with up to 4 decimals
export function price(n: number): string {
  return formatter("price", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);
}

// Price in the currency the market quotes it in ("USD" -> "$1,234.50"); small prices get more decimals
export function marketPrice(n: number, currency: string | null): string {
  // London quotes in pence ("GBp" or "GBX"): shown as 1,234.5p
  if (currency === "GBp" || currency === "GBX") {
    return `${formatter("pence", { maximumFractionDigits: 2 }).format(n)}p`;
  }
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : "EUR";
  const digits = n < 1 ? 4 : 2;
  return formatter(`market-${code}-${digits}`, {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(n);
}

// 0.123456 -> "0,123456" (in English, "0.123456")
export function units(n: number): string {
  return formatter("units", { maximumFractionDigits: 6 }).format(n);
}

// 12.3456 -> "12,35 %" (in English, "12.35%")
export function percent(n: number): string {
  const text = formatter("percent", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return language() === "en" ? `${text}%` : `${text} %`;
}

// A number to write in an input: 150.5 -> "150,5" (in English, "150.5")
export function numberToText(n: number): string {
  return language() === "en" ? String(n) : String(n).replace(".", ",");
}

// Rounds to cents
export function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

// Today's date as YYYY-MM-DD (the format the database understands)
export function today(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

// "2026-10-08" -> "08/10/2026"
export function prettyDate(f: string): string {
  const [a, m, d] = f.split("-");
  return `${d}/${m}/${a}`;
}

// "+12,34 €" / "−5,00 €"
export function withSign(n: number): string {
  return `${n >= 0 ? "+" : ""}${euros(n)}`;
}

// "+12,35 %" / "−3,10 %"
export function pctWithSign(n: number): string {
  return `${n >= 0 ? "+" : ""}${percent(n)}`;
}

// Color class for a gain: green if it gains, red if it loses
export function gainColor(n: number): string {
  return n < 0 ? "text-down" : "text-up";
}
