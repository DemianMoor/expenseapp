import { NextResponse } from "next/server";
import { dedupeRules, dedupeTxns, recategorize, rulesFromAnswers } from "@/lib/commit";
import { computeSubscriptionUpdates } from "@/lib/subscriptions";
import { isAuthed } from "@/lib/require-auth";
import {
  appendLedger,
  appendRules,
  ensureTabs,
  getSheetId,
  readLedgerIds,
  readRules,
  readSubscriptionTargets,
  readSummaryMonth,
  updateSubscriptions,
  writeSummary,
} from "@/lib/sheets";
import type { ReviewAnswer, Txn } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/commit
 * Body: { toAdd: Txn[], answers: ReviewAnswer[] }
 * Writes new rules, appends the ledger (deduped), rebuilds the summary, updates
 * subscriptions. Returns a confirmation payload.
 */
export async function POST(req: Request) {
  try {
    if (!(await isAuthed(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    const toAdd: Txn[] = Array.isArray(body.toAdd) ? body.toAdd : [];
    const answers: ReviewAnswer[] = Array.isArray(body.answers) ? body.answers : [];

    await ensureTabs();

    // 1. Learn new rules from the review answers.
    const existingRules = await readRules();
    const newRules = dedupeRules(existingRules, rulesFromAnswers(answers));
    if (newRules.length > 0) await appendRules(newRules);
    const allRules = [...existingRules, ...newRules];

    // 2. Re-categorize so freshly-learned merchants leave Uncategorized.
    const recategorized = recategorize(restoreDates(toAdd), allRules);

    // 3. Dedup against the existing ledger, then append (USD written as a
    //    date-based GOOGLEFINANCE formula; this also migrates older rows).
    const existingIds = await readLedgerIds();
    const { kept, skipped } = dedupeTxns(recategorized, existingIds);
    await appendLedger(kept);

    // 4. Install the live Monthly Summary QUERY (auto-sums the ledger, §5.8).
    await writeSummary();

    // 5. Update Subscriptions Last Paid from this upload's transactions,
    //    pinned to the card each subscription pays from (§5.7).
    const subTargets = await readSubscriptionTargets();
    const subUpdates = computeSubscriptionUpdates(allRules, recategorized, subTargets);
    const subscriptionsUpdated = await updateSubscriptions(subUpdates);

    // Current-month totals: read back the live summary (lets the date-based
    // GOOGLEFINANCE rates settle). currentMonth comes from the whole upload.
    const months = [...new Set(recategorized.map((t) => t.month))].filter(Boolean).sort();
    const currentMonth = months[months.length - 1] ?? "";
    const currentMonthTotals = currentMonth ? await readSummaryMonth(currentMonth) : [];

    return NextResponse.json({
      rowsAdded: kept.length,
      rowsSkippedDuplicate: skipped,
      rulesLearned: newRules.map((r) => r.keyword),
      subscriptionsUpdated,
      currentMonth,
      currentMonthTotals,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${getSheetId()}/edit`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** JSON round-trips drop the `_date` Date object; rebuild it from the MM/DD/YYYY field. */
function restoreDates(txns: Txn[]): Txn[] {
  return txns.map((t) => {
    const [mm, dd, yyyy] = (t.date || "").split("/").map((x) => Number(x));
    const d =
      mm && dd && yyyy ? new Date(Date.UTC(yyyy, mm - 1, dd)) : new Date(Date.UTC(1970, 0, 1));
    return { ...t, _date: d };
  });
}
