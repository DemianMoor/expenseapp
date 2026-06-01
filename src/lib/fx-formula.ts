import { TAB_FX } from "./seed";

// Ledger column letters (must match LEDGER_HEADER order in seed.ts):
//  A Transaction ID | B Date | C Month | D Card | E Merchant | F Description |
//  G Category | H Subscription | I MCC Desc | J Amount | K Currency | L USD | M Type
const COL_DATE = "B";
const COL_AMOUNT = "J";
const COL_CURRENCY = "K";

/**
 * Build a locale-safe DATE(...) expression from the MM/DD/YYYY string in the
 * Date column, so GOOGLEFINANCE gets a real date regardless of the sheet locale.
 */
function dateExpr(row: number): string {
  const b = `${COL_DATE}${row}`;
  return `DATE(VALUE(MID(${b},7,4)),VALUE(LEFT(${b},2)),VALUE(MID(${b},4,2)))`;
}

/**
 * Date-based USD conversion formula for ledger row `row` (§5.2, date-aware).
 *  - USD currency -> amount as-is.
 *  - else -> amount x GOOGLEFINANCE historical close on the transaction's date.
 *  - GOOGLEFINANCE unavailable (e.g. unsupported pair, future date, still
 *    loading) -> fall back to the manual `FX Rates` tab.
 *  - neither available -> blank (so the Monthly Summary QUERY keeps summing).
 * The amount cell is already signed (negative for credits), so the sign carries.
 */
export function usdFormula(row: number): string {
  const amt = `${COL_AMOUNT}${row}`;
  const cur = `${COL_CURRENCY}${row}`;
  const google = `ROUND(${amt}*INDEX(GOOGLEFINANCE("CURRENCY:"&${cur}&"USD","close",${dateExpr(row)}),2,2),2)`;
  const manual = `ROUND(${amt}*VLOOKUP(${cur},'${TAB_FX}'!$A:$B,2,FALSE),2)`;
  return `=IF(${cur}="USD",${amt},IFERROR(${google},IFERROR(${manual},"")))`;
}

/**
 * Monthly Summary as a single live QUERY over the ledger (§5.8). Recomputes
 * automatically as the ledger (and its date-based USD formulas) settle, so the
 * "current month accumulates / past months freeze" behavior is preserved with
 * zero server-side summation. Columns: C=Month, G=Category, L=USD.
 */
export function summaryQueryFormula(ledgerTab: string): string {
  const src = `'${ledgerTab}'!A2:M`;
  return `=IFERROR(QUERY(${src},"select C, G, sum(L) where A is not null and L is not null group by C, G order by C, G label sum(L) ''",0),)`;
}
