// Base asset types: everyone has them from day one and their name is shown in the chosen
// language. Each one is identified by its "key" (column asset_types.clave); the types the user
// creates have no key and are shown with the name they were given.
// Pure functions, no UI or database.
import type { Language } from "@/lib/language";

export type BaseTypeKey =
  | "bank_account"
  | "etf"
  | "fund"
  | "stock"
  | "crypto"
  | "savings_account"
  | "term_deposit"
  | "treasury_bills"
  | "pension_plan"
  | "bond"
  | "other";

export type BaseType = {
  base_key: BaseTypeKey;
  es: string;
  en: string;
  valuation: "market" | "balance";
  identifier: "isin" | "symbol" | "none";
  has_maturity: boolean;
  annual_return: number; // yearly % it starts with (each user changes it in Settings)
};

// The order is the one shown in Settings
export const BASE_TYPES: BaseType[] = [
  {
    base_key: "bank_account",
    es: "Cuenta bancaria",
    en: "Bank account",
    valuation: "balance",
    identifier: "none",
    has_maturity: false,
    annual_return: 0,
  },
  {
    base_key: "savings_account",
    es: "Cuenta remunerada",
    en: "Savings account",
    valuation: "balance",
    identifier: "none",
    has_maturity: false,
    annual_return: 2,
  },
  {
    base_key: "term_deposit",
    es: "Depósito",
    en: "Term deposit",
    valuation: "balance",
    identifier: "none",
    has_maturity: true,
    annual_return: 2.5,
  },
  {
    base_key: "treasury_bills",
    es: "Letras del Tesoro",
    en: "Treasury bills",
    valuation: "balance",
    identifier: "none",
    has_maturity: true,
    annual_return: 2.5,
  },
  {
    base_key: "etf",
    es: "ETF",
    en: "ETF",
    valuation: "market",
    identifier: "isin",
    has_maturity: false,
    annual_return: 7,
  },
  {
    base_key: "fund",
    es: "Fondo de inversión",
    en: "Investment fund",
    valuation: "market",
    identifier: "isin",
    has_maturity: false,
    annual_return: 7,
  },
  {
    base_key: "stock",
    es: "Acción",
    en: "Stock",
    valuation: "market",
    identifier: "isin",
    has_maturity: false,
    annual_return: 7,
  },
  {
    base_key: "bond",
    es: "Bono / Renta fija",
    en: "Bond",
    valuation: "market",
    identifier: "isin",
    has_maturity: false,
    annual_return: 3,
  },
  {
    base_key: "crypto",
    es: "Crypto",
    en: "Crypto",
    valuation: "market",
    identifier: "symbol",
    has_maturity: false,
    annual_return: 0,
  },
  // Many pension plans have no ISIN: their value is entered by hand
  {
    base_key: "pension_plan",
    es: "Plan de pensiones",
    en: "Pension plan",
    valuation: "market",
    identifier: "none",
    has_maturity: false,
    annual_return: 5,
  },
  {
    base_key: "other",
    es: "Otro",
    en: "Other",
    valuation: "balance",
    identifier: "none",
    has_maturity: false,
    annual_return: 0,
  },
];

// A type's name: a base type's name in the chosen language, or the one the user gave it
export function typeName(
  type: { name: string; base_key?: string | null } | null | undefined,
  language: Language,
): string | undefined {
  if (!type) return undefined;
  const base = BASE_TYPES.find((b) => b.base_key === type.base_key);
  return base ? (language === "en" ? base.en : base.es) : type.name;
}

// The asset_types rows missing for the user to have every base type
export function baseTypeRows(keysItHas: (string | null)[]) {
  return BASE_TYPES.filter((b) => !keysItHas.includes(b.base_key)).map((b) => ({
    base_key: b.base_key,
    name: b.es,
    valuation: b.valuation,
    identifier: b.identifier,
    has_maturity: b.has_maturity,
    annual_return: b.annual_return,
  }));
}
