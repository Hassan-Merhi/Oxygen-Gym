export const MONEY_SCALE = 6;
export const FX_SCALE = 8;

function roundTo(value: number, scale: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Non-finite accounting value: ${value}`);
  }
  const factor = 10 ** scale;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Normalize any persisted monetary value to the database NUMERIC scale. */
export function money(value: number): number {
  return roundTo(value, MONEY_SCALE);
}

/** Normalize a transaction FX rate to the database NUMERIC scale. */
export function fxRate(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Exchange rate must be greater than zero");
  }
  return roundTo(value, FX_SCALE);
}

export function addMoney(...values: number[]): number {
  return money(values.reduce((sum, value) => sum + money(value), 0));
}

export function subtractMoney(left: number, right: number): number {
  return money(money(left) - money(right));
}

export function multiplyMoney(value: number, multiplier: number): number {
  return money(money(value) * multiplier);
}

export function divideMoney(value: number, divisor: number): number {
  if (!Number.isFinite(divisor) || divisor === 0) {
    throw new Error("Accounting divisor must be non-zero");
  }
  return money(money(value) / divisor);
}
