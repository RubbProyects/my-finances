// Pure functions for the simulator: how much you'd have investing from scratch
//
// Same approach as the projection: the yearly % is split into an EQUIVALENT rate per
// period (with 7 % a year and weekly contributions, each week grows (1.07)^(1/52) − 1), so
// that over a year the total is exactly that %. Each contribution is made at the start of its
// period (the first one, today) and earns from then on. The initial contribution is separate.

export type Frequency = "weekly" | "monthly" | "yearly";

// Times a year a contribution is made
export const TIMES_PER_YEAR: Record<Frequency, number> = { weekly: 52, monthly: 12, yearly: 1 };

export type SimulationRow = {
  initial: number; // € you put in on day one
  contribution: number; // € each period
  frequency: Frequency;
  annualPct: number; // estimated yearly return in % (7 = 7 %)
};

export type SimulationPoint = { month: number; value: number; contributed: number };

// Contributions made after "years" years (can be fractional years: 0.5 = 6 months).
// Contributions happen at 0, 1/k, 2/k… years: the ones made are those before that moment.
export function contributionsMade(f: SimulationRow, years: number): number {
  return Math.max(0, Math.ceil(years * TIMES_PER_YEAR[f.frequency] - 1e-9));
}

// Value of a row after "years" years
export function simulatedValue(f: SimulationRow, years: number): number {
  const r = f.annualPct / 100;
  const n = contributionsMade(f, years);
  const growth = Math.pow(1 + r, years);
  if (r === 0) return f.initial + f.contribution * n;
  // Each contribution j (made at j/k years) grows (1 + r)^(years − j/k): it's a geometric sum
  const v = Math.pow(1 + r, -1 / TIMES_PER_YEAR[f.frequency]);
  return f.initial * growth + f.contribution * growth * ((1 - Math.pow(v, n)) / (1 - v));
}

// What you'll have put into a row after "years" years
export function simulatedContributed(f: SimulationRow, years: number): number {
  return f.initial + f.contribution * contributionsMade(f, years);
}

// Month-by-month series (from month 0 to the last) adding up every row
export function simulationSeries(rows: SimulationRow[], years: number): SimulationPoint[] {
  const series: SimulationPoint[] = [];
  for (let month = 0; month <= years * 12; month++) {
    series.push({
      month,
      value: rows.reduce((s, f) => s + simulatedValue(f, month / 12), 0),
      contributed: rows.reduce((s, f) => s + simulatedContributed(f, month / 12), 0),
    });
  }
  return series;
}
