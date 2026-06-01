import { NextResponse } from "next/server";
import { processRows } from "@/lib/process";
import { parseCsv } from "@/lib/parse";
import { ensureTabs, readFx, readRules } from "@/lib/sheets";
import { isAuthed } from "@/lib/require-auth";
import type { RawRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/process
 * Body: { csv: string } OR { rows: RawRow[] }
 * Reads rules + FX from the Sheet, categorizes, returns what to add / unknowns /
 * skipped / preview. Writes nothing.
 */
export async function POST(req: Request) {
  try {
    if (!(await isAuthed(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    let rows: RawRow[] = [];
    if (typeof body.csv === "string") rows = parseCsv(body.csv);
    else if (Array.isArray(body.rows)) rows = body.rows as RawRow[];
    else return NextResponse.json({ error: "Provide `csv` (string) or `rows` (array)." }, { status: 400 });

    await ensureTabs();
    const [rules, fx] = await Promise.all([readRules(), readFx()]);
    const result = processRows(rows, rules, fx);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
