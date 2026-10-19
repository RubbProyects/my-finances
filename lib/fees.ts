// Fee calculation from the fee schedules saved in the database

export type FeeSchedule = {
  id: string;
  platform_id: string;
  type_id: string;
  valid_from: string;
  percent: number;
  fixed: number;
  minimum: number;
  maximum: number | null;
  fx_percent: number;
};

// Finds the fee schedule for that platform and type that was in force on the given date
export function currentFeeSchedule(
  feeSchedules: FeeSchedule[],
  platformId: string | null,
  typeId: string,
  date: string,
): FeeSchedule | null {
  const candidates = feeSchedules
    .filter((t) => t.platform_id === platformId && t.type_id === typeId && t.valid_from <= date)
    .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1));
  return candidates[0] ?? null;
}

// Fee = (amount × % + fixed), with its minimum and maximum,
// plus the currency exchange % if the asset isn't in euros
export function calculateFee(
  feeSchedule: FeeSchedule | null,
  amount: number,
  otherCurrency: boolean,
): number {
  if (!feeSchedule || amount <= 0) return 0;
  let c = (amount * Number(feeSchedule.percent)) / 100 + Number(feeSchedule.fixed);
  c = Math.max(c, Number(feeSchedule.minimum));
  if (feeSchedule.maximum !== null) c = Math.min(c, Number(feeSchedule.maximum));
  if (otherCurrency) c += (amount * Number(feeSchedule.fx_percent)) / 100;
  return Math.round(c * 100) / 100;
}
