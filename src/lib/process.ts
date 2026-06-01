import { categorize, merchantKey } from "./categorize";
import { formatMMDDYYYY, formatMonth, parseDayFirst } from "./dates";
import { classify } from "./expense";
import { round2, toUsd } from "./fx";
import { col } from "./parse";
import { UNCATEGORIZED } from "./seed";
import type {
  FxRates,
  ProcessResult,
  RawRow,
  Rule,
  SkippedRow,
  SummaryRow,
  Txn,
  Unknown,
} from "./types";

/** Last-4 of a masked PAN -> "*0308". */
function cardLabel(pan: string): string {
  const digits = (pan || "").replace(/[^0-9]/g, "");
  const last4 = digits.slice(-4);
  return last4 ? `*${last4}` : "";
}

function num(s: string): number {
  return Number(String(s ?? "").replace(/[, ]/g, ""));
}

/**
 * Normalize a single raw row into a Txn, or return a skip/exclusion outcome.
 * `excluded` rows are silently dropped (authorisations, declines, zero-amount).
 * `skipped` rows are counted expenses we couldn't convert to USD (missing FX) — surfaced to the user.
 */
export function normalizeRow(
  row: RawRow,
  rules: Rule[],
  fx: FxRates
):
  | { kind: "txn"; txn: Txn }
  | { kind: "skipped"; skipped: SkippedRow }
  | { kind: "excluded" } {
  const cls = classify(row);
  if (!cls.counted) return { kind: "excluded" };

  const amountTxn = num(col(row, "Amount Txn"));
  const currency = col(row, "Currency Txn").trim().toUpperCase();
  const description = col(row, "Description");
  const transactionId = col(row, "Transaction ID");

  const usdMag = toUsd(Math.abs(amountTxn), currency, fx);
  if (usdMag === null) {
    return {
      kind: "skipped",
      skipped: {
        transactionId,
        description,
        amount: amountTxn,
        currency,
        reason: `No FX rate for ${currency}`,
      },
    };
  }

  const date = parseDayFirst(col(row, "Date Created"));
  const dateObj = date ?? new Date(Date.UTC(1970, 0, 1));

  const sign = cls.isCredit ? -1 : 1;
  const amountMag = Math.abs(amountTxn);
  const cat = categorize(description, col(row, "Transaction Type"), cls.isFee, rules);

  const txn: Txn = {
    transactionId,
    date: formatMMDDYYYY(dateObj),
    month: formatMonth(dateObj),
    card: cardLabel(col(row, "PAN")),
    merchant: cat.displayName || merchantKey(description),
    description,
    category: cat.category,
    subscription: cat.isSubscription ? "yes" : "no",
    mccDesc: col(row, "MCC Description"),
    amount: round2(sign * amountMag),
    currency,
    usd: round2(sign * usdMag),
    type: col(row, "Transaction Type"),
    _date: dateObj,
  };

  return { kind: "txn", txn };
}

/** Group Uncategorized txns by merchant key for the review screen (§5.5). */
export function groupUnknowns(txns: Txn[]): Unknown[] {
  const map = new Map<string, Unknown>();
  for (const t of txns) {
    if (t.category !== UNCATEGORIZED) continue;
    const key = merchantKey(t.description);
    let u = map.get(key);
    if (!u) {
      u = { merchantKey: key, count: 0, exampleUsd: [] };
      map.set(key, u);
    }
    u.count += 1;
    if (u.exampleUsd.length < 3) u.exampleUsd.push(Math.abs(t.usd));
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Build a long-format (month, category) -> sum(usd) summary from any rows carrying those fields (§5.8). */
export function buildSummary(txns: { month: string; category: string; usd: number }[]): SummaryRow[] {
  const map = new Map<string, SummaryRow>();
  for (const t of txns) {
    const key = `${t.month}|${t.category}`;
    const cur = map.get(key);
    if (cur) cur.usd = round2(cur.usd + t.usd);
    else map.set(key, { month: t.month, category: t.category, usd: round2(t.usd) });
  }
  return [...map.values()].sort((a, b) =>
    a.month === b.month ? a.category.localeCompare(b.category) : a.month.localeCompare(b.month)
  );
}

/**
 * The /api/process computation (§7). Reads rules + FX, normalizes/categorizes,
 * returns what to add, unknowns to review, rows skipped for missing FX, and a
 * preview summary of this upload. Writes nothing.
 */
export function processRows(rows: RawRow[], rules: Rule[], fx: FxRates): ProcessResult {
  const toAdd: Txn[] = [];
  const skippedNoFx: SkippedRow[] = [];

  for (const row of rows) {
    const r = normalizeRow(row, rules, fx);
    if (r.kind === "txn") toAdd.push(r.txn);
    else if (r.kind === "skipped") skippedNoFx.push(r.skipped);
  }

  const unknowns = groupUnknowns(toAdd);
  const summaryPreview = buildSummary(toAdd);

  return {
    toAdd,
    unknowns,
    skippedNoFx,
    summaryPreview,
    stats: {
      parsed: rows.length,
      counted: toAdd.length,
      needReview: unknowns.length,
    },
  };
}
