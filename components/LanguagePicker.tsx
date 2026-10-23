"use client";

import Collapsible from "@/components/Collapsible";
import { changeLanguage, language, type Language } from "@/lib/language";

// Each language with its name in that same language, so it's recognized even if you don't understand the other one
const LANGUAGES: { id: Language; text: string }[] = [
  { id: "es", text: "Español" },
  { id: "en", text: "English" },
];

// The buttons to choose the language (also shown on the sign-in screen)
export function languageButtons() {
  const chosen = language();
  return LANGUAGES.map((i) => (
    <button
      key={i.id}
      type="button"
      onClick={() => i.id !== chosen && changeLanguage(i.id)}
      aria-pressed={i.id === chosen}
      className={`flex-1 rounded border p-3 text-base ${
        i.id === chosen ? "border-accent font-semibold text-accent" : "border-line"
      }`}
    >
      {i.text}
    </button>
  ));
}

// Settings section to change the language
export default function LanguagePicker() {
  return (
    <Collapsible title="🌐 Idioma · Language">
      <div className="flex gap-2">{languageButtons()}</div>
    </Collapsible>
  );
}
