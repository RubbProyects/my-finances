// The messages the server writes (errors when fetching prices or transactions, bank warnings…)
// are in English, and some are saved in the database (for example, an asset's price warning,
// written by the nightly cron). That's why they aren't translated on the server but when
// shown: translateMessage() replaces each known phrase with the one in the chosen language and
// leaves the rest as is (for example, text sent by the bank itself).
// Before October 2026 the server wrote them in Spanish, and some of those may still be saved:
// in English they're translated the other way round.
// Pure function, no UI or database.
import type { Language } from "@/lib/language";

// [English phrase, Spanish phrase]. The parts that change go in braces, in the same order in
// both languages: {n} = a number, {w} = a word (no spaces), {t} = any text.
// "^" at the start and "$" at the end = only the whole text. "{end}" = end of the text or " ·".
const PHRASES: [string, string][] = [
  // Bank (lib/fetch-bank.ts, lib/enable-banking.ts and the bank routes)
  [
    "The bank won't let us read the account ({t}). Try connecting it again",
    "El banco no deja leer la cuenta ({t}). Prueba a volver a conectarlo",
  ],
  [
    "The permission has expired: connect the bank again in Settings",
    "El permiso ha caducado: vuelve a conectar el banco en Ajustes",
  ],
  [
    "The permission has expired: connect the bank again",
    "El permiso ha caducado: vuelve a conectar el banco",
  ],
  ["The bank didn't return any balance", "El banco no ha dado ningún saldo"],
  [
    "💱 It's in {w}: not read (the app only handles euros)",
    "💱 Está en {w}: no se lee (la app solo lleva euros)",
  ],
  [
    "💱 1 transaction in another currency isn't saved",
    "💱 1 movimiento en otra moneda no se guarda",
  ],
  [
    "💱 {n} transactions in another currency aren't saved",
    "💱 {n} movimientos en otra moneda no se guardan",
  ],
  [
    "ℹ️ The bank doesn't provide pending or held transactions",
    "ℹ️ El banco no da los pendientes ni los retenidos",
  ],
  ["Couldn't save", "No se ha podido guardar"],
  ["Choose a bank from the list", "Elige un banco de la lista"],
  ["The return code is missing", "Falta el código de vuelta"],
  [
    "The link was already used or has expired. Connect again",
    "El enlace ya se usó o ha caducado. Vuelve a conectar",
  ],
  ["^Cancelled$", "^Cancelado$"],
  [
    "The server is missing the ENABLE_BANKING_APP_ID and ENABLE_BANKING_KEY variables",
    "Faltan las variables ENABLE_BANKING_APP_ID y ENABLE_BANKING_KEY en el servidor",
  ],

  // Prices (lib/update-prices.ts, lib/yahoo.ts, lib/ft.ts and /api/symbols)
  ["Financial Times needs the asset's ISIN", "Financial Times necesita el ISIN del activo"],
  [
    "The Yahoo symbol is missing: add it in Settings → Edit",
    "Falta el símbolo de Yahoo: añádelo en Ajustes → Editar",
  ],
  [
    "{w} trades in {w} and the asset is in {w}: choose a symbol in {w}",
    "{w} cotiza en {w} y el activo está en {w}: elige un símbolo en {w}",
  ],
  ["The source returned no prices", "La fuente no ha devuelto precios"],
  ["Financial Times returned no recent prices", "Financial Times no ha devuelto precios recientes"],
  ["Financial Times can't find ISIN {w} in {w}", "Financial Times no encuentra el ISIN {w} en {w}"],
  ["Financial Times answered {n}", "Financial Times respondió {n}"],
  ["Yahoo answered {n}", "Yahoo respondió {n}"],
  ["Couldn't reach Yahoo", "No se pudo contactar con Yahoo"],
  ["Symbol not found on Yahoo", "Símbolo no encontrado en Yahoo"],
  ["Symbol not found", "Símbolo no encontrado"],
  ["Enter an ISIN, a symbol or a name", "Escribe un ISIN, un símbolo o un nombre"],
  ["^Fund · latest value: ", "^Fondo · último valor: "],
  [" · latest value: ", " · último valor: "],
  // Stock exchanges (only as a whole part of "name · exchange · type")
  ["· Xetra (Germany){end}", "· Xetra (Alemania){end}"],
  ["· Amsterdam{end}", "· Ámsterdam{end}"],
  ["· Milan{end}", "· Milán{end}"],
  ["· Paris{end}", "· París{end}"],
  ["· Frankfurt{end}", "· Fráncfort{end}"],
  ["^Xetra (Germany){end}", "^Xetra (Alemania){end}"],
  ["^Amsterdam{end}", "^Ámsterdam{end}"],
  ["^Milan{end}", "^Milán{end}"],
  ["^Paris{end}", "^París{end}"],
  ["^Frankfurt{end}", "^Fráncfort{end}"],

  // Session and server configuration
  ["Sign in again", "Inicia sesión otra vez"],
  [
    "The server is missing the SUPABASE_SECRET_KEY variable",
    "Falta la variable SUPABASE_SECRET_KEY en el servidor",
  ],
];

const GROUPS: Record<string, string> = { "{n}": "(\\d+)", "{w}": "(\\S+)", "{t}": "(.+)" };

// A phrase as a regular expression, to find it
function toRegExp(phrase: string): RegExp {
  const start = phrase.startsWith("^") ? "^" : "";
  const end = phrase.endsWith("$") ? "$" : "";
  const source = phrase
    .slice(start.length, phrase.length - end.length)
    .split(/(\{[nwt]\}|\{end\})/)
    .map((part) =>
      part === "{end}" ? "(?= ·|$)" : (GROUPS[part] ?? part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    )
    .join("");
  return new RegExp(start + source + end);
}

// A phrase as the text that replaces another one ("$1", "$2"… for the parts that change)
function toReplacement(phrase: string): string {
  let i = 0;
  return phrase
    .replace(/^\^|\$$/g, "")
    .replace(/\{end\}/g, "")
    .replace(/\{[nwt]\}/g, () => `$${++i}`);
}

// The longest first, so a short phrase doesn't change part of a long one
const rules = (pairs: [string, string][]): [RegExp, string][] =>
  pairs
    .map(([from, to]): [RegExp, string] => [toRegExp(from), toReplacement(to)])
    .sort((a, b) => b[0].source.length - a[0].source.length);
const TO_SPANISH = rules(PHRASES);
const TO_ENGLISH = rules(PHRASES.map(([en, es]) => [es, en]));

// The message in the chosen language: English messages are translated into Spanish, and old
// Spanish ones (still saved in the database) into English
export function translateMessage(text: string, language: Language): string {
  if (!text) return text;
  return (language === "en" ? TO_ENGLISH : TO_SPANISH).reduce(
    (t, [from, to]) => t.replace(from, to),
    text,
  );
}
