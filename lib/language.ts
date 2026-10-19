// App language: Spanish or English.
//
// How it's used: each on-screen text is written in both languages at once, in the same
// place, with t("Resumen", "Summary"). That way no text is left untranslated and you can see
// at a glance what each language says. Names the user creates (assets, categories...) aren't
// translated.
//
// The language is chosen in Settings and remembered on this device. The first time, the
// browser's language is used (Spanish if it is; otherwise, English); the public demo always starts
// in English. Changing it reloads the page.

import { DEMO } from "@/lib/demo";

export type Language = "es" | "en";

const STORAGE_KEY = "idioma";

let current: Language | null = null;

// Language the app is drawn in. On the server always Spanish, or English in the demo (there are
// no preferences there).
export function language(): Language {
  if (current) return current;
  if (typeof window === "undefined") return DEMO ? "en" : "es";
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {}
  current =
    saved === "es" || saved === "en"
      ? saved
      : !DEMO && (navigator.language ?? "").toLowerCase().startsWith("es")
        ? "es"
        : "en";
  return current;
}

// Saves the chosen language and reloads the page to draw it entirely in that language
export function changeLanguage(newOne: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, newOne);
  } catch {}
  window.location.reload();
}

// The text in the current language: t("Resumen", "Summary")
export function t(es: string, en: string): string {
  return language() === "en" ? en : es;
}

// Number and date format for each language (English uses the European one: 1,234.50 and dd/mm/yyyy)
export function locale(): string {
  return language() === "en" ? "en-GB" : "es-ES";
}
