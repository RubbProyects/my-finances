// Fund switches: the sale of the source fund and the purchase in the target fund are saved
// as two activities sharing the same traspaso_id.
import type { Language } from "@/lib/language";

// What's typed in a fund switch form
export type SwitchData = {
  source: string; // asset the money leaves
  target: string; // asset it goes into
  outDate: string; // date of the sale
  inDate: string; // date of the purchase (can be a few days later)
  amount: number; // euros switched (the same going out and coming in)
  unitsOut: number; // units leaving the source
  unitsIn: number; // units entering the target
  notes: string;
};

// Activity already saved, just enough to find pairs
export type SwitchOp = {
  id: string;
  asset_id: string;
  date: string;
  type: string;
  amount: number;
  switch_id: string | null;
};

// Price per unit with 6 decimals (enough for any fund)
function priceOf(amount: number, units: number): number {
  return Math.round((amount / units) * 1e6) / 1e6;
}

// The error text, or "" if all is fine. Whether there were enough units in the source
// is checked by the form, which has to ask the database.
export function switchError(d: SwitchData, language: Language = "es"): string {
  const tx = (es: string, en: string) => (language === "en" ? en : es);
  if (!d.source || !d.target)
    return tx("Elige el fondo de origen y el de destino", "Choose the source and target funds");
  if (d.source === d.target)
    return tx(
      "El fondo de origen y el de destino deben ser distintos",
      "The source and target funds must be different",
    );
  if (d.inDate < d.outDate)
    return tx(
      "La fecha de entrada no puede ser anterior a la de salida",
      "The date in can't be before the date out",
    );
  if (!(d.amount > 0))
    return tx("Escribe el importe traspasado (mayor que 0)", "Enter the amount switched (over 0)");
  if (!(d.unitsOut > 0))
    return tx("Escribe las participaciones que salen (más de 0)", "Enter the units out (over 0)");
  if (!(d.unitsIn > 0))
    return tx("Escribe las participaciones que entran (más de 0)", "Enter the units in (over 0)");
  return "";
}

// The two rows that get saved: [sale of the source, purchase in the target].
// No fee or account: the money moves from one fund to another without touching your accounts.
export function switchRows(d: SwitchData, switchId: string): Record<string, unknown>[] {
  const amount = Math.round(d.amount * 100) / 100;
  const common = {
    amount,
    fee: 0,
    withholding: 0,
    factor: null,
    account_id: null,
    notes: d.notes.trim() || null,
    switch_id: switchId,
  };
  return [
    {
      ...common,
      asset_id: d.source,
      date: d.outDate,
      type: "sell",
      price: priceOf(amount, d.unitsOut),
      units: d.unitsOut,
    },
    {
      ...common,
      asset_id: d.target,
      date: d.inDate,
      type: "buy",
      price: priceOf(amount, d.unitsIn),
      units: d.unitsIn,
    },
  ];
}

// "2026-10-15" + 3 days -> "2026-10-18"
function moreDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Buys that may be the other half of a sale already recorded: of another asset, not a switch,
// from 5 days before to 30 days after. Those with the closest amount first.
export function switchCandidates<T extends SwitchOp>(outgoing: SwitchOp, ops: T[]): T[] {
  const from = moreDays(outgoing.date, -5);
  const until = moreDays(outgoing.date, 30);
  const difference = (o: SwitchOp) => Math.abs(Number(o.amount) - Number(outgoing.amount));
  return ops
    .filter(
      (o) =>
        o.type === "buy" &&
        !o.switch_id &&
        o.asset_id !== outgoing.asset_id &&
        o.date >= from &&
        o.date <= until,
    )
    .sort((a, b) => difference(a) - difference(b) || a.date.localeCompare(b.date));
}

// The other half of a switch (or null if it isn't there)
export function pairOf<T extends SwitchOp>(o: SwitchOp, ops: T[]): T | null {
  if (!o.switch_id) return null;
  return ops.find((x) => x.switch_id === o.switch_id && x.id !== o.id) ?? null;
}
