"use client";

import type { ReactNode } from "react";

// Section that opens and closes when its title is tapped.
// "summary" is what is shown to the right of the title even when closed (e.g. a total).
export default function Collapsible({
  title,
  summary,
  open = false,
  nested = false,
  onOpen,
  children,
}: {
  title: ReactNode;
  summary?: ReactNode;
  open?: boolean;
  nested?: boolean;
  onOpen?: (isOpen: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      open={open}
      onToggle={(e) => onOpen?.((e.currentTarget as HTMLDetailsElement).open)}
      className={`group rounded border ${nested ? "border-gray-400/50" : "border-gray-400"}`}
    >
      <summary
        className={`flex cursor-pointer list-none items-center justify-between gap-3 p-3 [&::-webkit-details-marker]:hidden ${
          nested ? "font-medium" : "font-semibold"
        }`}
      >
        <span className="min-w-0">{title}</span>
        <span className="flex shrink-0 items-center gap-2 text-right">
          {summary}
          <span className="text-sm opacity-60 transition-transform group-open:rotate-180">▾</span>
        </span>
      </summary>
      <div className="flex flex-col gap-3 px-3 pb-3">{children}</div>
    </details>
  );
}
