// Splits: each split stores the units it adds
// (the ones you had that day × (factor − 1)). If an earlier activity changes,
// that number goes out of date: here it's recalculated.

export type SplitOp = {
  id: string;
  date: string;
  type: string;
  units: number | string | null; // the database may send them as text
  factor: number | string | null;
};

export type SplitChange = { id: string; date: string; before: number; after: number };

// Differences smaller than this are rounding, not real changes
const TOLERANCE = 1e-6;

// How much each activity adds to or subtracts from the number of units
function effect(type: string, units: number): number {
  if (type === "sell") return -units;
  if (type === "buy" || type === "split") return units;
  return 0;
}

// Receives every activity of an asset and returns the splits whose number must change.
// Splits are recalculated from oldest to newest, because each one counts the previous ones.
export function recalculateSplits(ops: SplitOp[]): SplitChange[] {
  const list = ops.map((o) => ({ ...o, units: Number(o.units ?? 0) }));
  const splits = list
    .filter((o) => o.type === "split")
    .sort((a, b) => a.date.localeCompare(b.date));
  const changes: SplitChange[] = [];

  for (const s of splits) {
    // Same as when saving a split: what you had that day (inclusive), without counting the split itself
    const held = list
      .filter((o) => o.id !== s.id && o.date <= s.date)
      .reduce((sum, o) => sum + effect(o.type, o.units), 0);
    const after = Math.max(held, 0) * (Number(s.factor ?? 1) - 1);
    if (Math.abs(after - s.units) > TOLERANCE) {
      changes.push({ id: s.id, date: s.date, before: s.units, after });
      s.units = after; // later splits already count with the new number
    }
  }
  return changes;
}
