import { formatMMDDYYYY } from "./dates";
import type { Rule, Txn } from "./types";

export interface SubscriptionUpdate {
  displayName: string;
  lastPaid: string; // MM/DD/YYYY
}

/** A row from the user-curated subscriptions tab that we may update. */
export interface SubTarget {
  serviceName: string;
  /** Card the subscription is paid on (e.g. "*0308"); "" means any card. */
  card: string;
}

/**
 * Compute Subscriptions `Last Paid` updates (§5.7).
 * For each rule with Is Subscription = yes and a Display Name:
 *  - find counted txns whose Description contains the keyword,
 *  - if the rule has an Amount Anchor, keep only txns within +/-1.5 USD of it,
 *  - if `targets` pins the matching subscription to a Card, keep only txns on that card,
 *  - take the latest by date.
 * Rules sharing a Display Name (e.g. NAMECHEAP / NAME-CHEAP) are merged; latest wins.
 *
 * The Card filter resolves the real-world case where the same merchant (Proton)
 * is charged on two cards in one period: the subscription row names the card it
 * actually pays from, so only that card's charge sets Last Paid. Does NOT touch
 * the Amount column (Gotcha #6).
 */
export function computeSubscriptionUpdates(
  rules: Rule[],
  txns: Txn[],
  targets?: SubTarget[]
): SubscriptionUpdate[] {
  // Map a (lowercased) service name -> its pinned card, when targets are given.
  const cardByName = targets
    ? new Map(targets.map((t) => [t.serviceName.trim().toLowerCase(), (t.card || "").trim()]))
    : null;

  const latest = new Map<string, Date>();

  for (const rule of rules) {
    if (!rule.isSubscription) continue;
    const name = (rule.displayName || "").trim();
    if (!name) continue;
    const kw = (rule.keyword || "").toUpperCase().trim();
    if (!kw) continue;

    // If we have targets, only update names that actually exist in the tab.
    let pinnedCard = "";
    if (cardByName) {
      const key = name.toLowerCase();
      if (!cardByName.has(key)) continue;
      pinnedCard = cardByName.get(key) ?? "";
    }

    for (const t of txns) {
      if (!t.description.toUpperCase().includes(kw)) continue;
      if (rule.amountAnchor !== null && Math.abs(Math.abs(t.usd) - rule.amountAnchor) > 1.5) continue;
      if (pinnedCard && t.card !== pinnedCard) continue;
      const prev = latest.get(name);
      if (!prev || t._date.getTime() > prev.getTime()) {
        latest.set(name, t._date);
      }
    }
  }

  return [...latest.entries()].map(([displayName, d]) => ({
    displayName,
    lastPaid: formatMMDDYYYY(d),
  }));
}
