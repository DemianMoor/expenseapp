import { FEE_CATEGORY, UNCATEGORIZED, TAB_RULES } from "./seed";

// Ledger columns: F = Description, G = Category, M = Type.
const COL_DESC = "F";
const COL_TYPE = "M";

/**
 * Live category formula for ledger row `row`, mirroring categorize.ts in-sheet:
 *  - Type = "Fee"  -> Banking & Card Fees.
 *  - else: first Merchant Rules keyword (top-to-bottom) that appears as a
 *    substring of the Description wins -> its Category.
 *  - no match -> Uncategorized.
 *
 * Matching is case-insensitive (SEARCH). Keyword wildcard chars (* ? ~) are
 * escaped so e.g. "GOOGLE*CLOUD" matches literally. Blank keyword rows are
 * ignored. Editing the Merchant Rules tab re-categorizes every row instantly.
 */
export function categoryFormula(row: number): string {
  const desc = `$${COL_DESC}${row}`;
  const type = `$${COL_TYPE}${row}`;
  const kw = `'${TAB_RULES}'!$A$2:$A`;
  const cat = `'${TAB_RULES}'!$B$2:$B`;
  // Escape ~ then * and ? inside each keyword so SEARCH treats them literally.
  const kwLiteral = `SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(${kw},"~","~~"),"*","~*"),"?","~?")`;
  const firstMatch = `MATCH(1,(LEN(${kw})>0)*ISNUMBER(SEARCH(${kwLiteral},${desc})),0)`;
  return `=IF(${type}="Fee","${FEE_CATEGORY}",IFERROR(INDEX(${cat},${firstMatch}),"${UNCATEGORIZED}"))`;
}
