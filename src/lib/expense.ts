import { col } from "./parse";
import type { RawRow } from "./types";

export interface Classification {
  /** Whether this row counts as an expense at all. */
  counted: boolean;
  /** A counted row that is a refund/reversal -> applied as a negative. */
  isCredit: boolean;
  /** A Fee/Cleared row -> categorized Banking & Card Fees by type. */
  isFee: boolean;
  /** Reason a row was excluded (for debugging; empty when counted). */
  excludeReason: string;
}

function num(s: string): number {
  if (!s) return NaN;
  // Tolerate thousands separators / stray spaces.
  return Number(String(s).replace(/[, ]/g, ""));
}

/** Is `Reversal Amount Bill` non-empty? ("-", "", "0" all count as empty.) */
export function hasReversalAmount(value: string): boolean {
  const v = (value ?? "").trim();
  if (v === "" || v === "-") return false;
  const n = num(v);
  if (!Number.isNaN(n) && n === 0) return false;
  return true;
}

function mentionsRefund(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  return t.includes("refund") || t.includes("reversal");
}

/**
 * Classify a raw row per §5.1.
 * Count: (Presentment & Settled) OR (Fee & Cleared).
 * Credit: a counted row whose Note/Status Desc mentions refund/reversal,
 *         OR Reversal Amount Bill is non-empty.
 * Exclude: Authorisation, Auth Reversal, anything Declined, Amount Txn == 0.
 */
export function classify(row: RawRow): Classification {
  const type = col(row, "Transaction Type").trim();
  const status = col(row, "Transaction Status").trim();
  const amountTxn = num(col(row, "Amount Txn"));

  const out: Classification = {
    counted: false,
    isCredit: false,
    isFee: false,
    excludeReason: "",
  };

  if (Number.isNaN(amountTxn) || amountTxn === 0) {
    out.excludeReason = "Amount Txn is 0/blank";
    return out;
  }

  const isPresentmentSettled = type === "Presentment" && status === "Settled";
  const isFeeCleared = type === "Fee" && status === "Cleared";

  if (!isPresentmentSettled && !isFeeCleared) {
    out.excludeReason = `not counted (type=${type}, status=${status})`;
    return out;
  }

  out.counted = true;
  out.isFee = isFeeCleared;

  const isRefund =
    mentionsRefund(col(row, "Note")) ||
    mentionsRefund(col(row, "Status Desc")) ||
    hasReversalAmount(col(row, "Reversal Amount Bill"));
  out.isCredit = isRefund;

  return out;
}
