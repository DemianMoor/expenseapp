import type { FxRates } from "./types";

/**
 * Convert an amount to USD using the FX Rates tab (§5.2).
 * Returns null if the currency has no rate (caller must skip + warn).
 * Rounds to 2 dp. Sign handling (credits) is applied by the caller.
 */
export function toUsd(amount: number, currency: string, fx: FxRates): number | null {
  const cur = (currency || "").trim().toUpperCase();
  if (cur === "USD") return round2(amount);
  const rate = fx[cur];
  if (rate === undefined || rate === null || Number.isNaN(rate)) return null;
  return round2(amount * rate);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
