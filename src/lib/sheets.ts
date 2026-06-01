import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { google, type sheets_v4 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import {
  DEFAULT_SHEET_ID,
  FX_HEADER,
  LEDGER_HEADER,
  RULES_HEADER,
  SEED_FX,
  SEED_RULES,
  SUMMARY_HEADER,
  TAB_FX,
  TAB_LEDGER,
  TAB_RULES,
  TAB_SUBSCRIPTIONS,
  TAB_SUMMARY,
} from "./seed";
import type { FxRates, Rule, SummaryRow, Txn } from "./types";
import type { SubscriptionUpdate, SubTarget } from "./subscriptions";
import { summaryQueryFormula, usdFormula } from "./fx-formula";

export const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

export function getSheetId(): string {
  return process.env.SHEET_ID || DEFAULT_SHEET_ID;
}

const OAUTH_CLIENT_PATH = process.env.GOOGLE_OAUTH_CLIENT_PATH || resolve(process.cwd(), "oauth_client.json");
const TOKEN_PATH = process.env.GOOGLE_TOKEN_PATH || resolve(process.cwd(), ".google-token.json");

/** Resolve the OAuth client {id, secret} from env (Vercel) or the local file. */
function loadOAuthClientConf(): { client_id: string; client_secret: string } | null {
  // Prefer the two short, paste-safe vars when present.
  if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return {
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID.trim(),
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET.trim(),
    };
  }
  // Base64 of the whole oauth_client.json. Tolerate a mangled value (don't crash).
  const b64 = process.env.GOOGLE_OAUTH_CLIENT_B64;
  if (b64) {
    try {
      const raw = JSON.parse(Buffer.from(b64.replace(/\s+/g, ""), "base64").toString("utf-8"));
      const conf = raw.installed || raw.web || raw;
      if (conf?.client_id && conf?.client_secret) return conf;
    } catch {
      // fall through — a corrupt B64 must not take down auth
    }
  }
  if (existsSync(OAUTH_CLIENT_PATH)) {
    const raw = JSON.parse(readFileSync(OAUTH_CLIENT_PATH, "utf-8"));
    const conf = raw.installed || raw.web;
    if (conf?.client_id && conf?.client_secret) return conf;
  }
  return null;
}

/** Resolve the stored OAuth token (refresh_token) from env (Vercel) or the local file. */
function loadOAuthToken(): Record<string, unknown> | null {
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    return { refresh_token: process.env.GOOGLE_REFRESH_TOKEN };
  }
  if (existsSync(TOKEN_PATH)) {
    return JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
  }
  return null;
}

function hasOAuthConfig(): boolean {
  return loadOAuthClientConf() !== null && loadOAuthToken() !== null;
}

/**
 * Build an OAuth2 client from an installed/desktop client + a stored refresh token.
 * Works locally (oauth_client.json + .google-token.json) and on Vercel
 * (GOOGLE_OAUTH_CLIENT_B64 + GOOGLE_REFRESH_TOKEN). Throws if either is missing.
 */
export function makeOAuthClient(): OAuth2Client {
  const conf = loadOAuthClientConf();
  if (!conf) {
    throw new Error("No OAuth client. Set GOOGLE_OAUTH_CLIENT_B64 (or _ID/_SECRET), or add oauth_client.json.");
  }
  const client = new google.auth.OAuth2(conf.client_id, conf.client_secret, "http://localhost");
  const token = loadOAuthToken();
  if (!token) {
    throw new Error("Not authorized. Set GOOGLE_REFRESH_TOKEN, or run `npm run authorize` locally.");
  }
  client.setCredentials(token);
  return client;
}

/** Service-account fallback (kept from the brief's original design). */
function makeServiceAccountAuth() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  const credsJson = b64
    ? Buffer.from(b64, "base64").toString("utf-8")
    : process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf-8")
      : null;
  if (!credsJson) return null;
  return new google.auth.GoogleAuth({ credentials: JSON.parse(credsJson), scopes: SCOPES });
}

let cached: sheets_v4.Sheets | null = null;

export function getSheets(): sheets_v4.Sheets {
  if (cached) return cached;

  // Prefer OAuth (env vars on Vercel, or local files). Fall back to a service account.
  if (hasOAuthConfig()) {
    const auth = makeOAuthClient();
    cached = google.sheets({ version: "v4", auth });
    return cached;
  }

  const saAuth = makeServiceAccountAuth();
  if (saAuth) {
    cached = google.sheets({ version: "v4", auth: saAuth });
    return cached;
  }

  throw new Error(
    "No Google credentials. Set GOOGLE_OAUTH_CLIENT_B64 + GOOGLE_REFRESH_TOKEN (Vercel), add oauth_client.json + run `npm run authorize` (local), or set GOOGLE_SERVICE_ACCOUNT_B64."
  );
}

// ---------- low-level helpers ----------

async function getValues(range: string): Promise<string[][]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range,
  });
  return (res.data.values as string[][]) ?? [];
}

async function setValues(
  range: string,
  values: (string | number)[][],
  valueInputOption: "RAW" | "USER_ENTERED" = "RAW"
): Promise<void> {
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSheetId(),
    range,
    valueInputOption,
    requestBody: { values },
  });
}

async function appendValues(range: string, values: (string | number)[][]): Promise<void> {
  if (values.length === 0) return;
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSheetId(),
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

async function clearValues(range: string): Promise<void> {
  const sheets = getSheets();
  await sheets.spreadsheets.values.clear({ spreadsheetId: getSheetId(), range });
}

// ---------- tab management ----------

async function listTabTitles(): Promise<string[]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.get({ spreadsheetId: getSheetId() });
  return (res.data.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
}

/** Spreadsheet title + tab list — used by the health check to confirm access. */
export async function getSpreadsheetInfo(): Promise<{ title: string; tabs: string[] }> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.get({ spreadsheetId: getSheetId() });
  return {
    title: res.data.properties?.title ?? "",
    tabs: (res.data.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean),
  };
}

async function createTab(title: string): Promise<void> {
  const sheets = getSheets();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSheetId(),
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
}

/**
 * Create the four managed tabs if missing and seed rules/FX (§4).
 * Leaves the existing, user-curated Subscriptions tab alone.
 */
export async function ensureTabs(): Promise<{ created: string[] }> {
  const existing = new Set(await listTabTitles());
  const created: string[] = [];

  if (!existing.has(TAB_LEDGER)) {
    await createTab(TAB_LEDGER);
    await setValues(`${TAB_LEDGER}!A1`, [LEDGER_HEADER]);
    created.push(TAB_LEDGER);
  }
  if (!existing.has(TAB_RULES)) {
    await createTab(TAB_RULES);
    await setValues(`${TAB_RULES}!A1`, [RULES_HEADER, ...SEED_RULES.map(ruleToRow)]);
    created.push(TAB_RULES);
  }
  if (!existing.has(TAB_FX)) {
    await createTab(TAB_FX);
    const fxRows = Object.entries(SEED_FX).map(([c, r]) => [c, r] as (string | number)[]);
    await setValues(`${TAB_FX}!A1`, [FX_HEADER, ...fxRows]);
    created.push(TAB_FX);
  }
  if (!existing.has(TAB_SUMMARY)) {
    await createTab(TAB_SUMMARY);
    await setValues(`${TAB_SUMMARY}!A1`, [SUMMARY_HEADER]);
    created.push(TAB_SUMMARY);
  }

  return { created };
}

// ---------- readers ----------

export async function readRules(): Promise<Rule[]> {
  const rows = await getValues(`${TAB_RULES}!A2:E`);
  return rows
    .filter((r) => (r[0] ?? "").trim() !== "")
    .map((r) => ({
      keyword: (r[0] ?? "").trim(),
      category: (r[1] ?? "").trim(),
      isSubscription: yesNo(r[2]),
      displayName: (r[3] ?? "").trim(),
      amountAnchor: parseAnchor(r[4]),
    }));
}

export async function readFx(): Promise<FxRates> {
  const rows = await getValues(`${TAB_FX}!A2:B`);
  const fx: FxRates = {};
  for (const r of rows) {
    const cur = (r[0] ?? "").trim().toUpperCase();
    const rate = Number(String(r[1] ?? "").replace(/[, ]/g, ""));
    if (cur && !Number.isNaN(rate)) fx[cur] = rate;
  }
  return fx;
}

/** Existing Transaction IDs in the ledger, for dedup (§5.3). */
export async function readLedgerIds(): Promise<Set<string>> {
  const rows = await getValues(`${TAB_LEDGER}!A2:A`);
  return new Set(rows.map((r) => (r[0] ?? "").trim()).filter(Boolean));
}

/** Full ledger as Txn-like records (for rebuilding the summary). */
export async function readLedger(): Promise<{ month: string; category: string; usd: number }[]> {
  const rows = await getValues(`${TAB_LEDGER}!A2:M`);
  // Columns per LEDGER_HEADER: ... [2]=Month, [6]=Category, [11]=USD
  return rows
    .filter((r) => (r[0] ?? "").trim() !== "")
    .map((r) => ({
      month: (r[2] ?? "").trim(),
      category: (r[6] ?? "").trim(),
      usd: Number(String(r[11] ?? "0").replace(/[, ]/g, "")) || 0,
    }));
}

// ---------- writers ----------

export async function appendRules(rules: Rule[]): Promise<void> {
  await appendValues(`${TAB_RULES}!A1`, rules.map(ruleToRow));
}

/** 1-based index of the first empty ledger row (header is row 1). */
async function nextLedgerRow(): Promise<number> {
  const colA = await getValues(`${TAB_LEDGER}!A:A`);
  return colA.length + 1;
}

/**
 * Append txns at a deterministic location (so per-row USD formulas reference the
 * right cells). Text columns are written RAW to avoid formula injection from
 * merchant strings; the USD column is then (re)written as a date-based formula.
 */
export async function appendLedger(txns: Txn[]): Promise<void> {
  if (txns.length > 0) {
    const start = await nextLedgerRow();
    await setValues(`${TAB_LEDGER}!A${start}`, txns.map(txnToRow), "RAW");
  }
  await refreshLedgerUsdFormulas();
}

/**
 * (Re)write the USD column (L) as date-based GOOGLEFINANCE formulas for every
 * data row. Idempotent; also migrates pre-existing numeric USD cells.
 */
export async function refreshLedgerUsdFormulas(): Promise<number> {
  const colA = await getValues(`${TAB_LEDGER}!A2:A`);
  const n = colA.filter((r) => (r[0] ?? "").trim() !== "").length;
  if (n === 0) return 0;
  const formulas = Array.from({ length: n }, (_, i) => [usdFormula(i + 2)]);
  await setValues(`${TAB_LEDGER}!L2:L${n + 1}`, formulas, "USER_ENTERED");
  return n;
}

/** Install the live Monthly Summary QUERY formula (§5.8). Idempotent. */
export async function writeSummary(): Promise<void> {
  await clearValues(`${TAB_SUMMARY}!A2:C`);
  await setValues(`${TAB_SUMMARY}!A2`, [[summaryQueryFormula(TAB_LEDGER)]], "USER_ENTERED");
}

/**
 * Read back the (computed) Monthly Summary rows for one month, retrying briefly
 * so GOOGLEFINANCE/QUERY have a chance to resolve after a write.
 */
export async function readSummaryMonth(month: string, attempts = 5): Promise<SummaryRow[]> {
  for (let i = 0; i < attempts; i++) {
    const rows = await getValues(`${TAB_SUMMARY}!A2:C`);
    const forMonth = rows
      .filter((r) => (r[0] ?? "").trim() === month && (r[1] ?? "").trim() !== "")
      .map((r) => ({
        month: (r[0] ?? "").trim(),
        category: (r[1] ?? "").trim(),
        usd: Number(String(r[2] ?? "0").replace(/[, ]/g, "")) || 0,
      }));
    // Resolved if we have rows and none are still computing (NaN -> 0 already).
    if (forMonth.length > 0) return forMonth.sort((a, b) => b.usd - a.usd);
    if (i < attempts - 1) await sleep(1200);
  }
  return [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Resolve the user-curated subscriptions tab. The brief calls it "Subscriptions",
 * but the real Sheet may name it differently (e.g. "Payments"). Detection order:
 *   1. SUBSCRIPTIONS_TAB env override,
 *   2. the first tab whose header row has both "Service Name" and "Last Paid",
 *   3. fall back to the constant.
 * Returns null if nothing matches (commit then skips the subs update gracefully).
 */
export async function resolveSubscriptionsTab(): Promise<string | null> {
  const override = process.env.SUBSCRIPTIONS_TAB;
  const tabs = await listTabTitles();
  const candidates = override ? [override, ...tabs] : [TAB_SUBSCRIPTIONS, ...tabs];
  const seen = new Set<string>();
  for (const tab of candidates) {
    if (!tab || seen.has(tab) || !tabs.includes(tab)) continue;
    seen.add(tab);
    const header = (await getValues(`${tab}!A1:Z1`))[0] ?? [];
    const lower = header.map((h) => (h ?? "").trim().toLowerCase());
    if (lower.includes("service name") && lower.includes("last paid")) return tab;
  }
  return null;
}

/**
 * Read the subscriptions tab's Service Name + Card columns, so Last Paid can be
 * matched to the card a subscription actually pays from (§5.7 card disambiguation).
 */
export async function readSubscriptionTargets(): Promise<SubTarget[]> {
  const tab = await resolveSubscriptionsTab();
  if (!tab) return [];
  const grid = await getValues(`${tab}!A1:Z`);
  if (grid.length === 0) return [];
  const header = grid[0].map((h) => (h ?? "").trim().toLowerCase());
  const nameCol = header.indexOf("service name");
  const cardCol = header.indexOf("card");
  if (nameCol === -1) return [];
  const out: SubTarget[] = [];
  for (let i = 1; i < grid.length; i++) {
    const serviceName = (grid[i][nameCol] ?? "").trim();
    if (!serviceName) continue;
    out.push({ serviceName, card: cardCol === -1 ? "" : (grid[i][cardCol] ?? "").trim() });
  }
  return out;
}

/**
 * Update Last Paid on existing subscriptions rows whose Service Name matches a
 * Display Name. Adds/deletes nothing; only writes the Last Paid cell (§5.7).
 * Returns the list of names actually updated.
 */
export async function updateSubscriptions(updates: SubscriptionUpdate[]): Promise<string[]> {
  if (updates.length === 0) return [];
  const tab = await resolveSubscriptionsTab();
  if (!tab) return [];
  const grid = await getValues(`${tab}!A1:Z`);
  if (grid.length === 0) return [];

  const header = grid[0].map((h) => (h ?? "").trim().toLowerCase());
  const nameCol = header.indexOf("service name");
  const lastPaidCol = header.indexOf("last paid");
  if (nameCol === -1 || lastPaidCol === -1) return [];

  const byName = new Map(updates.map((u) => [u.displayName.trim().toLowerCase(), u.lastPaid]));
  const updated: string[] = [];
  const data: sheets_v4.Schema$ValueRange[] = [];

  for (let i = 1; i < grid.length; i++) {
    const serviceName = (grid[i][nameCol] ?? "").trim();
    const hit = byName.get(serviceName.toLowerCase());
    if (hit) {
      const a1 = `${tab}!${colLetter(lastPaidCol)}${i + 1}`;
      data.push({ range: a1, values: [[hit]] });
      updated.push(serviceName);
    }
  }

  if (data.length > 0) {
    const sheets = getSheets();
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getSheetId(),
      requestBody: { valueInputOption: "RAW", data },
    });
  }
  return updated;
}

// ---------- row mappers ----------

function ruleToRow(r: Rule): (string | number)[] {
  return [r.keyword, r.category, r.isSubscription ? "yes" : "no", r.displayName, r.amountAnchor ?? ""];
}

function txnToRow(t: Txn): (string | number)[] {
  return [
    t.transactionId,
    t.date,
    t.month,
    t.card,
    t.merchant,
    t.description,
    t.category,
    t.subscription,
    t.mccDesc,
    t.amount,
    t.currency,
    "", // USD: filled by refreshLedgerUsdFormulas() as a date-based formula
    t.type,
  ];
}

// ---------- small parsers ----------

function yesNo(v: string | undefined): boolean {
  return (v ?? "").trim().toLowerCase() === "yes";
}

function parseAnchor(v: string | undefined): number | null {
  const s = (v ?? "").trim();
  if (s === "") return null;
  const n = Number(s.replace(/[, ]/g, ""));
  return Number.isNaN(n) ? null : n;
}

function colLetter(idx: number): string {
  let n = idx;
  let s = "";
  do {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
