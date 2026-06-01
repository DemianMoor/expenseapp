import { categorize, merchantKey } from "./categorize";
import type { ReviewAnswer, Rule, Txn } from "./types";

/** Turn review answers into new Merchant Rules (Keyword = uppercased merchant key). */
export function rulesFromAnswers(answers: ReviewAnswer[]): Rule[] {
  return answers
    .filter((a) => a.merchantKey.trim() !== "" && a.category.trim() !== "")
    .map((a) => ({
      keyword: a.merchantKey.trim().toUpperCase(),
      category: a.category.trim(),
      isSubscription: a.isSubscription,
      displayName: (a.displayName ?? "").trim(),
      amountAnchor: null,
    }));
}

/** Keep only rules whose keyword isn't already present (case-insensitive). */
export function dedupeRules(existing: Rule[], incoming: Rule[]): Rule[] {
  const seen = new Set(existing.map((r) => r.keyword.toUpperCase().trim()));
  const out: Rule[] = [];
  for (const r of incoming) {
    const k = r.keyword.toUpperCase().trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** Re-apply categorization to normalized txns with the full rule set (§5.6). */
export function recategorize(txns: Txn[], rules: Rule[]): Txn[] {
  return txns.map((t) => {
    const cat = categorize(t.description, t.type, t.type === "Fee", rules);
    return {
      ...t,
      category: cat.category,
      subscription: cat.isSubscription ? "yes" : "no",
      merchant: cat.displayName || merchantKey(t.description),
    };
  });
}

/** Drop txns whose Transaction ID already exists in the ledger (§5.3). */
export function dedupeTxns(txns: Txn[], existingIds: Set<string>): { kept: Txn[]; skipped: number } {
  const kept: Txn[] = [];
  let skipped = 0;
  const seenThisBatch = new Set<string>();
  for (const t of txns) {
    const id = t.transactionId.trim();
    if (!id || existingIds.has(id) || seenThisBatch.has(id)) {
      skipped += 1;
      continue;
    }
    seenThisBatch.add(id);
    kept.push(t);
  }
  return { kept, skipped };
}
