// Pure functions for the future projection (no UI or database)
//
// Approach: monthly interest EQUIVALENT to the yearly one. With 7 % a year, each month grows
// (1.07)^(1/12) − 1 ≈ 0.565 %, so that over 12 months the total is exactly 7 %.
// Each contribution is made at the start of the month and earns from that same month.
//
// The gain is measured on what YOU put in (like the Investments %), not on what it's
// worth today: if you bought for €10,000 and it'll be worth €30,000, the gain is +200 %.

export type ProjectionInput = {
  initial: number; // what it's worth today (compound interest grows on this)
  contribution: number; // € a month
  annualPct: number; // estimated yearly return in % (7 = 7 %)
  putIn: number; // what was contributed so far (what was bought; for an account, today's balance)
  received: number; // what it has already paid back (sales and dividends): counts as gain
};

export type ProjectionPoint = {
  month: number;
  value: number;
  contributed: number;
  received: number;
};

// yearly % -> equivalent monthly rate (per unit)
export function monthlyRate(annualPct: number): number {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
}

// Value of an asset after "months" months
export function valueAfter(e: ProjectionInput, months: number): number {
  const i = monthlyRate(e.annualPct);
  if (i === 0) return e.initial + e.contribution * months;
  const f = Math.pow(1 + i, months);
  return e.initial * f + e.contribution * ((f - 1) / i) * (1 + i);
}

// What you'll have put in after "months" months: contributed so far + contributions
export function contributedAfter(e: ProjectionInput, months: number): number {
  return e.putIn + e.contribution * months;
}

// Gain in € after "months" months: value + already received − put in
export function gainAfter(e: ProjectionInput, months: number): number {
  return valueAfter(e, months) + e.received - contributedAfter(e, months);
}

// Month-by-month series (from month 0 to the last) adding up every asset
export function projectionSeries(inputs: ProjectionInput[], years: number): ProjectionPoint[] {
  const series: ProjectionPoint[] = [];
  for (let month = 0; month <= years * 12; month++) {
    series.push({
      month,
      value: inputs.reduce((s, e) => s + valueAfter(e, month), 0),
      contributed: inputs.reduce((s, e) => s + contributedAfter(e, month), 0),
      received: inputs.reduce((s, e) => s + e.received, 0),
    });
  }
  return series;
}

// Relative gain: gain ÷ contributed, in %
export function relativeGain(gain: number, contributed: number): number | null {
  return contributed > 0 ? (gain / contributed) * 100 : null;
}

// Adds months to a "YYYY-MM-DD" date (if the day doesn't exist, it stays on the month's last day)
export function addMonths(date: string, months: number): string {
  const [a, m, d] = date.split("-").map(Number);
  const total = a * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
