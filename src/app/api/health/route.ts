import { NextResponse } from "next/server";
import {
  ensureTabs,
  getSheetId,
  getSpreadsheetInfo,
  readFx,
  readRules,
  resolveSubscriptionsTab,
} from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 * Confirms Google auth + Sheet access end-to-end: opens the sheet, ensures the
 * managed tabs exist (creating/seeding any that are missing — the intended
 * first-run behavior), then reads rules + FX back. Touches no transaction data.
 */
export async function GET() {
  try {
    const before = await getSpreadsheetInfo();
    const { created } = await ensureTabs();
    const after = await getSpreadsheetInfo();
    const [rules, fx, subsTab] = await Promise.all([
      readRules(),
      readFx(),
      resolveSubscriptionsTab(),
    ]);

    return NextResponse.json({
      ok: true,
      sheetId: getSheetId(),
      title: after.title,
      tabsBefore: before.tabs,
      tabsCreated: created,
      tabsAfter: after.tabs,
      ruleCount: rules.length,
      fxRates: fx,
      subscriptionsTab: subsTab,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
