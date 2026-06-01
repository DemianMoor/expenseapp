// Shared domain types for the Colibrix -> Google Sheets expense categorizer.

/** A raw CSV row as parsed by PapaParse (header mode). Keys are the 27 column names. */
export type RawRow = Record<string, string>;

/** A learned merchant -> category rule (one row in the `Merchant Rules` tab). */
export interface Rule {
  /** Uppercased substring matched against `Description`. */
  keyword: string;
  category: string;
  isSubscription: boolean;
  /** Clean name used for the Subscriptions tab row. Empty if none. */
  displayName: string;
  /** Optional USD amount to disambiguate one merchant billing multiple products. null = no anchor. */
  amountAnchor: number | null;
}

/** Currency code -> USD multiplier (one row in the `FX Rates` tab). */
export type FxRates = Record<string, number>;

/** A counted, normalized transaction ready for the ledger. */
export interface Txn {
  transactionId: string;
  /** Display date, MM/DD/YYYY. */
  date: string;
  /** YYYY-MM bucket. */
  month: string;
  /** Card, as *1234. */
  card: string;
  /** Clean merchant display name (rule display name, else merchant key). */
  merchant: string;
  /** Raw Description string from the CSV. */
  description: string;
  category: string;
  /** "yes" | "no" */
  subscription: string;
  mccDesc: string;
  /** Original amount in the merchant's currency (signed: negative for credits). */
  amount: number;
  currency: string;
  /** USD value, 2dp, signed (negative for credits). */
  usd: number;
  /** Transaction Type from the CSV (Presentment / Fee). */
  type: string;
  /** Sort key — original parsed Date. Not written to the sheet. */
  _date: Date;
}

/** A merchant that matched no rule, grouped for the review screen. */
export interface Unknown {
  /** Cleaned merchant key (also the suggested rule Keyword). */
  merchantKey: string;
  count: number;
  /** A few example USD amounts (absolute values). */
  exampleUsd: number[];
}

/** A row that could not be converted to USD (missing FX rate). */
export interface SkippedRow {
  transactionId: string;
  description: string;
  amount: number;
  currency: string;
  reason: string;
}

/** One (month, category) total for the Monthly Summary tab. */
export interface SummaryRow {
  month: string;
  category: string;
  usd: number;
}

/** Result of /api/process — computed, nothing written yet. */
export interface ProcessResult {
  /** Normalized counted transactions (may include Uncategorized ones). */
  toAdd: Txn[];
  unknowns: Unknown[];
  skippedNoFx: SkippedRow[];
  /** Preview of the *current upload's* category totals (not the full ledger). */
  summaryPreview: SummaryRow[];
  stats: {
    parsed: number;
    counted: number;
    needReview: number;
  };
}

/** A user's answer for one unknown merchant in the review screen. */
export interface ReviewAnswer {
  merchantKey: string;
  category: string;
  isSubscription: boolean;
  displayName: string;
}
