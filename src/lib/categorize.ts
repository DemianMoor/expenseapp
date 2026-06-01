import { FEE_CATEGORY, UNCATEGORIZED } from "./seed";
import type { Rule } from "./types";

/**
 * Cleaned merchant key for grouping unknowns (§5.5):
 *   Description.split('\\')[0].split('*')[0].trim()
 */
export function merchantKey(description: string): string {
  return (description || "").split("\\")[0].split("*")[0].trim();
}

export interface CategoryResult {
  category: string;
  isSubscription: boolean;
  displayName: string;
  matchedRule: Rule | null;
}

/**
 * Categorize a transaction (§5.4).
 * - Fee transactions -> Banking & Card Fees by type (no rule needed).
 * - Match on `Description` ONLY (uppercased substring contains Keyword). NEVER Card Tag (Gotcha #1).
 * - First matching rule wins. No match -> Uncategorized.
 */
export function categorize(description: string, type: string, isFee: boolean, rules: Rule[]): CategoryResult {
  if (isFee || type === "Fee") {
    return { category: FEE_CATEGORY, isSubscription: false, displayName: "", matchedRule: null };
  }

  const desc = (description || "").toUpperCase();
  for (const rule of rules) {
    const kw = (rule.keyword || "").toUpperCase().trim();
    if (kw && desc.includes(kw)) {
      return {
        category: rule.category,
        isSubscription: rule.isSubscription,
        displayName: rule.displayName,
        matchedRule: rule,
      };
    }
  }

  return { category: UNCATEGORIZED, isSubscription: false, displayName: "", matchedRule: null };
}
