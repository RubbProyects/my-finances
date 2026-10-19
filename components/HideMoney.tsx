"use client";

import { useEffect, useState } from "react";
import { t } from "@/lib/language";

// 👁️ button to blur money (everything with "€") and still see the rest, like the
// percentages. It's remembered on this device. It works by marking with data-dinero the
// elements whose text has "€"; the CSS (globals.css) blurs them.
const MARK = "data-dinero";
const STORAGE_KEY = "ocultar-dinero";

function removeMarks() {
  for (const el of document.querySelectorAll(`[${MARK}]`)) el.removeAttribute(MARK);
}

function mark() {
  removeMarks();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    // Dropdowns (<select>) can't be blurred inside
    if (n.nodeValue?.includes("€") && parent && !parent.closest("select, textarea")) {
      parent.setAttribute(MARK, "");
    }
  }
}

function readHidden(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function HideMoney() {
  const [hidden, setHidden] = useState(readHidden);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
    } catch {}
    if (!hidden) return;
    mark();
    // Every time the screen changes (another tab, new data...) it marks again
    const observer = new MutationObserver(mark);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      removeMarks();
    };
  }, [hidden]);

  const label = hidden
    ? t("Mostrar el dinero", "Show money")
    : t("Ocultar el dinero", "Hide money");

  return (
    <button
      type="button"
      onClick={() => setHidden((o) => !o)}
      aria-pressed={hidden}
      aria-label={label}
      title={label}
      className="rounded-full border border-gray-400/60 px-3 py-1 text-xl"
    >
      {hidden ? "🙈" : "👁️"}
    </button>
  );
}
