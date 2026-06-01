# Colibrix → Google Sheets Expense Categorizer

A single-operator web app. Upload the weekly Colibrix credit-card CSV; it converts
every charge to USD, auto-categorizes known merchants, asks you to categorize
anything new (and remembers forever), and maintains an accumulating ledger +
month-by-month summary — **entirely inside one Google Sheet. No database.**

Built per [`colibrix-expense-app-BUILD-BRIEF.md`](./colibrix-expense-app-BUILD-BRIEF.md).

## Stack

- Next.js (App Router) + TypeScript
- `googleapis` (Sheets API, service-account auth, server-side only)
- PapaParse for CSV parsing
- Vitest for the rule-logic test suite

## Architecture

```
src/lib/         pure, testable business logic (no I/O)
  types.ts         domain types
  seed.ts          categories, starter rules, FX seed, tab names
  dates.ts         DD/MM/YYYY (day-first) parsing  [Gotcha #2]
  parse.ts         CSV parse + UTF-8 BOM strip      [Gotcha #3]
  expense.ts       which rows count as an expense   [§5.1]
  fx.ts            USD conversion (preview/static)  [§5.2]
  fx-formula.ts    date-based GOOGLEFINANCE formulas for the ledger + summary
  categorize.ts    Description-only matching        [§5.4, Gotcha #1]
  process.ts       normalize + group unknowns + summary
  commit.ts        learn rules, re-categorize, dedup
  subscriptions.ts Last-Paid upsert with Amount Anchor [§5.7, Gotcha #4]
  sheets.ts        the ONLY I/O layer — Google Sheets adapter

src/app/
  page.tsx                 Upload → Review → Confirm UI
  api/process/route.ts     POST /api/process  (reads sheet, computes, writes nothing)
  api/commit/route.ts      POST /api/commit   (writes rules, ledger, summary, subs)

test/core.test.ts          rule-logic tests + synthetic fixture
```

## Setup

1. **Google Cloud**: create a project → enable **Sheets API** + **Drive API** →
   create a **service account** → download its JSON key.
2. **Share the Sheet** (`15RqqqvqARGgv76FoGZK3emqpDTVOjmcQKuiI9PHgpAg`, confirm
   first) with the service account's `client_email` as **Editor**.
3. Copy env: `cp .env.example .env` and point it at your key — either
   `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json` (local) or
   `GOOGLE_SERVICE_ACCOUNT_B64=<base64 of the JSON>` (Vercel).
4. Install + run:

   ```bash
   npm install
   npm run dev      # http://localhost:3000
   ```

On first run the app creates the `All Transactions`, `Merchant Rules`,
`FX Rates`, and `Monthly Summary` tabs (seeding rules + FX). The existing,
user-curated `Subscriptions` tab is updated in place, never recreated.

## Weekly workflow

1. **Upload** the Colibrix CSV.
2. **Review** any unknown merchants — pick a category, mark subscriptions, give a
   clean name. Each answer becomes a permanent `Merchant Rules` row.
3. **Confirm** — new rows are appended (deduped by `Transaction ID`), the monthly
   summary is rebuilt from the whole ledger, and Subscriptions `Last Paid` is
   refreshed. You get totals and a link to the Sheet.

## Commands

```bash
npm run dev        # local dev server
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm test           # rule-logic test suite (no network / no credentials needed)
```

## Notes on the hard-won gotchas (§9)

- **Categorize on `Description` only**, never `Card Tag` — see `categorize.ts`.
- **`Date Created` is day-first** (`DD/MM/YYYY`) — see `dates.ts`.
- **UTF-8 BOM** is stripped on parse — see `parse.ts`.
- **Amount Anchor** disambiguates one merchant billing multiple products — see
  `subscriptions.ts`.
- **Dedup by `Transaction ID`**; **rebuild the summary from the whole ledger**
  each run (idempotent); **never overwrite Subscriptions `Amount`**.

The acceptance numbers in §10 of the brief are validated against the operator's
real May 2026 CSV (not committed). The test suite here validates every rule in
§5 against a synthetic fixture so a regression is caught without credentials.

## Deploy to Vercel

The app runs serverlessly with credentials supplied as env vars.

1. **Import** `github.com/DemianMoor/expenseapp` in the Vercel dashboard
   (New Project → Import). Framework auto-detects as **Next.js** — no build
   settings to change.
2. **Environment variables** (Project → Settings → Environment Variables). Run
   `node scripts/print-env.mjs` locally to get the values, then add:
   - `SHEET_ID`
   - `GOOGLE_OAUTH_CLIENT_B64` — base64 of `oauth_client.json`
   - `GOOGLE_REFRESH_TOKEN` — the refresh token from `.google-token.json`
   - `APP_PASSWORD` — the login password for the public URL
3. **Deploy.** Visit the URL → enter `APP_PASSWORD` → use normally.

**Important — avoid a weekly auth break:** if the Google OAuth consent screen is
in *Testing*, refresh tokens expire after 7 days. In Google Cloud Console →
*OAuth consent screen*, **Publish app** (Production). Then re-run
`npm run authorize` once and update `GOOGLE_REFRESH_TOKEN` in Vercel with the new
value. (Internal/Workspace user type also avoids the expiry.)

The app password gate is active whenever `APP_PASSWORD` is set; leave it unset
locally to skip the login screen.

## Date-based FX via GOOGLEFINANCE

Conversion to USD happens **inside the Sheet, using live Google rates for each
transaction's own date** (not a single static rate):

- The ledger `USD` column is a formula (see `fx-formula.ts`):
  `=IF(Currency="USD", Amount, ROUND(Amount * GOOGLEFINANCE("CURRENCY:"&Currency&"USD","close", <txn date>), 2))`
  with a locale-safe `DATE(...)` built from the `MM/DD/YYYY` cell.
- If Google can't resolve a rate (unsupported pair, future date, still loading),
  it **falls back to the manual `FX Rates` tab**; if that also fails, the cell is
  left blank. So `FX Rates` is now an editable override/fallback, not the primary
  source.
- `Monthly Summary` is a single live `QUERY` over the ledger, so it recomputes
  automatically as rates settle — past months freeze, the current month
  accumulates, with no server-side summation.

Because rates are now live and date-specific, USD totals differ from the brief's
static-rate §10 fixture (e.g. EUR was ~1.16 in late May 2026 vs the old 1.08, so
EUR-denominated card fees come out higher). The Node-side `fx.ts` static map is
still used for the upload **preview** and for the subscription Amount-Anchor
match; the authoritative USD values live in the Sheet.
