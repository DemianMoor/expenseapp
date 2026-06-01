import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/parse";
import { parseDayFirst, formatMMDDYYYY, formatMonth } from "@/lib/dates";
import { classify } from "@/lib/expense";
import { toUsd } from "@/lib/fx";
import { categorize, merchantKey } from "@/lib/categorize";
import { buildSummary, groupUnknowns, processRows } from "@/lib/process";
import { computeSubscriptionUpdates } from "@/lib/subscriptions";
import { dedupeRules, dedupeTxns, recategorize, rulesFromAnswers } from "@/lib/commit";
import { SEED_FX, SEED_RULES } from "@/lib/seed";
import { summaryFormula, usdFormula } from "@/lib/fx-formula";
import { categoryFormula } from "@/lib/category-formula";
import type { Txn } from "@/lib/types";

// --- Synthetic fixture. 14 columns we actually read; first header carries a BOM. ---
const HEADERS = [
  "Transaction ID",
  "Card Tag",
  "PAN",
  "Transaction Type",
  "Transaction Status",
  "Status Desc",
  "Note",
  "Amount Txn",
  "Currency Txn",
  "Reversal Amount Bill",
  "MCC",
  "MCC Description",
  "Description",
  "Date Created",
];

type Row = (string | number)[];

const ROWS: Row[] = [
  // 1. Card Tag says "Vercel GK" but Description is GOOGLE*CLOUD -> must NOT match Vercel (Gotcha #1)
  ["T1", "Vercel GK", "446619******0308", "Presentment", "Settled", "", "", "30.00", "USD", "", "", "Cloud", "GOOGLE*CLOUD\\WWW 19808 DE USA", "05/05/2026 10:00:00"],
  // 2. Real Vercel charge (subscription) on 05/05/2026
  ["T2", "MainCard", "446619******1111", "Presentment", "Settled", "", "", "30.00", "USD", "", "", "Cloud", "VERCEL* MONTHLY\\VERCEL.COM", "05/05/2026 09:00:00"],
  // 3. Fee / Cleared, EUR -> Banking & Card Fees
  ["T3", "MainCard", "446619******1111", "Fee", "Cleared", "", "", "0.50", "EUR", "", "", "Fee", "FX FEE", "05/06/2026 09:00:00"],
  // 4. Authorisation -> excluded
  ["T4", "MainCard", "446619******1111", "Authorisation", "Accepted", "", "", "99.00", "USD", "", "", "", "SOMETHING", "05/06/2026 09:00:00"],
  // 5. Declined -> excluded
  ["T5", "MainCard", "446619******1111", "Presentment", "Declined", "", "", "12.00", "USD", "", "", "", "DECLINED MERCHANT", "05/06/2026 09:00:00"],
  // 6. Amount 0 -> excluded
  ["T6", "MainCard", "446619******1111", "Presentment", "Settled", "", "", "0", "USD", "", "", "", "ZERO MERCHANT", "05/06/2026 09:00:00"],
  // 7. Refund via Note -> negative
  ["T7", "MainCard", "446619******1111", "Presentment", "Settled", "", "Refund issued", "10.00", "USD", "", "", "", "ANTHROPIC* API", "05/07/2026 09:00:00"],
  // 8. Reversal Amount Bill non-empty -> negative
  ["T8", "MainCard", "446619******1111", "Presentment", "Settled", "", "", "5.00", "USD", "5.00", "", "", "OPENAI* GPT", "05/07/2026 09:00:00"],
  // 9. Proton EUR 9.99 (subscription) on 04/05/2026 (day-first = May 4)
  ["T9", "MainCard", "446619******1111", "Presentment", "Settled", "", "", "9.99", "EUR", "", "", "Soft", "PROTON* PROTON AG\\WWW.PROTON.ME", "04/05/2026 12:00:00"],
  // 10. Namecheap 11.48 USD on 04/05/2026 -> anchor match
  ["T10", "MainCard", "446619******1111", "Presentment", "Settled", "", "", "11.48", "USD", "", "", "Domain", "NAMECHEAP.COM* GUIDEKIN\\WWW.NAMECHEAP", "04/05/2026 08:00:00"],
  // 11. Namecheap 7.68 USD on 25/05/2026 -> NOT anchor (off by >1.5)
  ["T11", "MainCard", "446619******1111", "Presentment", "Settled", "", "", "7.68", "USD", "", "", "Domain", "NAMECHEAP.COM* OTHERDOM\\WWW.NAMECHEAP", "25/05/2026 08:00:00"],
  // 12. Unknown currency GBP -> skipped, no FX
  ["T12", "MainCard", "446619******1111", "Presentment", "Settled", "", "", "20.00", "GBP", "", "", "", "BRITISH MERCH", "05/08/2026 08:00:00"],
  // 13. Unknown merchant -> review queue
  ["T13", "MainCard", "446619******1111", "Presentment", "Settled", "", "", "10.65", "USD", "", "", "", "CHATROULETTE\\PAY 12345 US", "05/09/2026 08:00:00"],
];

function buildCsv(): string {
  const lines = [HEADERS.join(","), ...ROWS.map((r) => r.map(csvCell).join(","))];
  return "﻿" + lines.join("\n"); // prepend UTF-8 BOM
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

describe("dates (day-first)", () => {
  it("parses DD/MM/YYYY HH:MM:SS as day-first", () => {
    const d = parseDayFirst("04/05/2026 12:00:00")!;
    expect(formatMMDDYYYY(d)).toBe("05/04/2026");
    expect(formatMonth(d)).toBe("2026-05");
  });
  it("rejects garbage", () => {
    expect(parseDayFirst("not a date")).toBeNull();
  });
});

describe("parse", () => {
  it("strips the UTF-8 BOM so the first column key is clean", () => {
    const rows = parseCsv(buildCsv());
    expect(rows.length).toBe(ROWS.length);
    expect(rows[0]["Transaction ID"]).toBe("T1");
  });
});

describe("classify (§5.1)", () => {
  const rows = parseCsv(buildCsv());
  const byId = (id: string) => rows.find((r) => r["Transaction ID"] === id)!;

  it("counts Presentment+Settled and Fee+Cleared", () => {
    expect(classify(byId("T2")).counted).toBe(true);
    expect(classify(byId("T3")).counted).toBe(true);
    expect(classify(byId("T3")).isFee).toBe(true);
  });
  it("excludes Authorisation, Declined, and Amount=0", () => {
    expect(classify(byId("T4")).counted).toBe(false);
    expect(classify(byId("T5")).counted).toBe(false);
    expect(classify(byId("T6")).counted).toBe(false);
  });
  it("flags refunds (Note) and reversals (Reversal Amount Bill) as credits", () => {
    expect(classify(byId("T7")).isCredit).toBe(true);
    expect(classify(byId("T8")).isCredit).toBe(true);
  });
});

describe("fx (§5.2)", () => {
  it("USD passthrough, EUR converts, unknown -> null", () => {
    expect(toUsd(10, "USD", SEED_FX)).toBe(10);
    expect(toUsd(0.5, "EUR", SEED_FX)).toBe(0.54);
    expect(toUsd(20, "GBP", SEED_FX)).toBeNull();
  });
});

describe("categorize (§5.4, Gotcha #1)", () => {
  it("matches GOOGLE*CLOUD, never Vercel, despite the 'Vercel GK' card tag", () => {
    const c = categorize("GOOGLE*CLOUD\\WWW 19808 DE USA", "Presentment", false, SEED_RULES);
    expect(c.category).toBe("Infrastructure & Hosting");
    expect(c.isSubscription).toBe(false); // GOOGLE*CLOUD rule, not the Vercel(subscription) rule
  });
  it("Fee rows -> Banking & Card Fees regardless of description", () => {
    expect(categorize("anything", "Fee", true, SEED_RULES).category).toBe("Banking & Card Fees");
  });
  it("no match -> Uncategorized", () => {
    expect(categorize("CHATROULETTE\\PAY", "Presentment", false, SEED_RULES).category).toBe("Uncategorized");
  });
  it("merchantKey strips after backslash and asterisk", () => {
    expect(merchantKey("NAMECHEAP.COM* GUIDEKIN\\WWW.NAMECHEAP")).toBe("NAMECHEAP.COM");
    expect(merchantKey("CHATROULETTE\\PAY 12345 US")).toBe("CHATROULETTE");
  });
});

describe("processRows (end-to-end normalize)", () => {
  const rows = parseCsv(buildCsv());
  const res = processRows(rows, SEED_RULES, SEED_FX);
  const find = (id: string) => res.toAdd.find((t) => t.transactionId === id);

  it("counts the right rows and skips the FX-less GBP charge", () => {
    // Counted: T1,T2,T3,T7,T8,T9,T10,T11,T13 = 9. Excluded: T4,T5,T6. Skipped: T12.
    expect(res.toAdd.length).toBe(9);
    expect(res.skippedNoFx.map((s) => s.transactionId)).toEqual(["T12"]);
  });

  it("applies credits as negative USD", () => {
    expect(find("T7")!.usd).toBe(-10);
    expect(find("T8")!.usd).toBe(-5);
  });

  it("converts EUR and rounds to 2dp", () => {
    expect(find("T3")!.usd).toBe(0.54); // 0.50 * 1.08
    expect(find("T9")!.usd).toBe(10.79); // 9.99 * 1.08 = 10.7892
  });

  it("uses day-first dates and YYYY-MM months", () => {
    expect(find("T9")!.date).toBe("05/04/2026");
    expect(find("T9")!.month).toBe("2026-05");
  });

  it("renders card as *last4", () => {
    expect(find("T1")!.card).toBe("*0308");
  });

  it("the GOOGLE*CLOUD row is Infrastructure, not Vercel", () => {
    expect(find("T1")!.category).toBe("Infrastructure & Hosting");
    expect(find("T1")!.subscription).toBe("no");
  });

  it("surfaces exactly one unknown merchant (CHATROULETTE)", () => {
    expect(res.unknowns.map((u) => u.merchantKey)).toEqual(["CHATROULETTE"]);
    expect(res.stats.needReview).toBe(1);
  });
});

describe("subscriptions (§5.7, Gotcha #4 anchor)", () => {
  const rows = parseCsv(buildCsv());
  const res = processRows(rows, SEED_RULES, SEED_FX);
  const updates = computeSubscriptionUpdates(SEED_RULES, res.toAdd);
  const get = (name: string) => updates.find((u) => u.displayName === name);

  it("Namecheap Last Paid uses the $11.48 anchored charge (05/04), NOT the $7.68 (05/25)", () => {
    expect(get("Namecheap - guidekin.com")?.lastPaid).toBe("05/04/2026");
  });
  it("Proton Last Paid is the May 4 charge", () => {
    expect(get("Proton demmoor")?.lastPaid).toBe("05/04/2026");
  });
  it("Vercel Last Paid is the real Vercel charge (T2), not GOOGLE*CLOUD", () => {
    expect(get("Vercel")?.lastPaid).toBe("05/05/2026");
  });
});

describe("subscriptions — card pinning (Proton two-card case)", () => {
  const proton = (id: string, date: string, card: string, usd: number): Txn => ({
    transactionId: id,
    date,
    month: "2026-05",
    card,
    merchant: "Proton demmoor",
    description: "PROTON* PROTON AG\\WWW.PROTON.ME",
    category: "Software & Productivity",
    subscription: "yes",
    mccDesc: "",
    amount: usd,
    currency: "USD",
    usd,
    type: "Presentment",
    _date: parseDayFirst(`${date.slice(3, 5)}/${date.slice(0, 2)}/${date.slice(6)} 00:00:00`)!,
  });

  // Two Proton charges: later one on *6074, earlier one on *0308.
  const txns = [proton("P1", "05/20/2026", "*6074", 4.56), proton("P2", "05/04/2026", "*0308", 4.99)];
  const protonRule = SEED_RULES.find((r) => r.keyword === "PROTON")!;

  it("without a card pin, picks the latest charge (05/20)", () => {
    const u = computeSubscriptionUpdates([protonRule], txns);
    expect(u.find((x) => x.displayName === "Proton demmoor")?.lastPaid).toBe("05/20/2026");
  });

  it("pinned to *0308, picks the 05/04 charge on that card", () => {
    const u = computeSubscriptionUpdates([protonRule], txns, [
      { serviceName: "Proton demmoor", card: "*0308" },
    ]);
    expect(u.find((x) => x.displayName === "Proton demmoor")?.lastPaid).toBe("05/04/2026");
  });

  it("only updates service names present in the targets", () => {
    const u = computeSubscriptionUpdates([protonRule], txns, [
      { serviceName: "Something Else", card: "" },
    ]);
    expect(u.length).toBe(0);
  });
});

describe("summary (§5.8, multi-word categories)", () => {
  it("groups by (month, category) and keeps category names intact", () => {
    const summary = buildSummary([
      { month: "2026-05", category: "SMS, Voice & Numbers", usd: 100 },
      { month: "2026-05", category: "SMS, Voice & Numbers", usd: 50 },
      { month: "2026-05", category: "Domains & DNS", usd: 10 },
    ]);
    const sms = summary.find((r) => r.category === "SMS, Voice & Numbers");
    expect(sms?.usd).toBe(150);
    expect(summary.length).toBe(2);
  });
});

describe("fx formulas (date-based GOOGLEFINANCE)", () => {
  it("USD passthrough, else GOOGLEFINANCE by the row's date, FX Rates fallback", () => {
    const f = usdFormula(2);
    expect(f.startsWith("=IF(K2=\"USD\",J2,")).toBe(true);
    expect(f).toContain('GOOGLEFINANCE("CURRENCY:"&K2&"USD","close"');
    // locale-safe date built from the MM/DD/YYYY string in column B
    expect(f).toContain("DATE(VALUE(MID(B2,7,4)),VALUE(LEFT(B2,2)),VALUE(MID(B2,4,2)))");
    // amount (signed) carries the sign
    expect(f).toContain("J2*INDEX(GOOGLEFINANCE");
    // manual fallback to the FX Rates tab
    expect(f).toContain("VLOOKUP(K2,'FX Rates'!$A:$B,2,FALSE)");
  });

  it("references the right row number", () => {
    expect(usdFormula(53)).toContain("K53");
    expect(usdFormula(53)).toContain("B53");
  });

  it("category formula: Fee shortcut, Merchant Rules lookup, Uncategorized fallback", () => {
    const f = categoryFormula(2);
    expect(f).toContain('IF($M2="Fee","Banking & Card Fees"');
    expect(f).toContain("'Merchant Rules'!$A$2:$A");
    expect(f).toContain("'Merchant Rules'!$B$2:$B");
    expect(f).toContain("SEARCH(");
    expect(f).toContain("$F2"); // matches against the Description column
    expect(f).toContain('"Uncategorized"');
    // wildcard chars in keywords are escaped so GOOGLE*CLOUD matches literally
    expect(f).toContain('SUBSTITUTE');
  });

  it("category formula references the right row", () => {
    expect(categoryFormula(40)).toContain("$F40");
    expect(categoryFormula(40)).toContain("$M40");
  });

  it("summary formula: per-month category rows + a Total row, grouped/summed", () => {
    const q = summaryFormula("All Transactions");
    expect(q).toContain("'All Transactions'!A2:M");
    expect(q).toContain("select C, G, sum(L)");
    expect(q).toContain("group by C, G");
    expect(q).toContain('"Total"'); // bold total row per month
    expect(q).toContain("REDUCE"); // stacks each month's block
  });
});

describe("commit helpers", () => {
  it("rulesFromAnswers uppercases the keyword", () => {
    const rules = rulesFromAnswers([
      { merchantKey: "chatroulette", category: "Software & Productivity", isSubscription: true, displayName: "Chatroulette" },
    ]);
    expect(rules[0].keyword).toBe("CHATROULETTE");
    expect(rules[0].isSubscription).toBe(true);
  });

  it("dedupeRules drops keywords that already exist", () => {
    const added = dedupeRules(SEED_RULES, [
      { keyword: "VERCEL", category: "x", isSubscription: false, displayName: "", amountAnchor: null },
      { keyword: "NEWONE", category: "x", isSubscription: false, displayName: "", amountAnchor: null },
    ]);
    expect(added.map((r) => r.keyword)).toEqual(["NEWONE"]);
  });

  it("recategorize moves an unknown out of Uncategorized once a rule exists", () => {
    const rows = parseCsv(buildCsv());
    const res = processRows(rows, SEED_RULES, SEED_FX);
    const newRules = rulesFromAnswers([
      { merchantKey: "CHATROULETTE", category: "Software & Productivity", isSubscription: false, displayName: "" },
    ]);
    const recat = recategorize(res.toAdd, [...SEED_RULES, ...newRules]);
    expect(recat.find((t) => t.transactionId === "T13")!.category).toBe("Software & Productivity");
    expect(groupUnknowns(recat).length).toBe(0);
  });

  it("dedupeTxns removes IDs already in the ledger and within-batch dupes", () => {
    const rows = parseCsv(buildCsv());
    const res = processRows(rows, SEED_RULES, SEED_FX);
    const existing = new Set(["T2"]);
    const { kept, skipped } = dedupeTxns(res.toAdd, existing);
    expect(kept.find((t) => t.transactionId === "T2")).toBeUndefined();
    expect(skipped).toBe(1);
    expect(kept.length).toBe(res.toAdd.length - 1);
  });
});
