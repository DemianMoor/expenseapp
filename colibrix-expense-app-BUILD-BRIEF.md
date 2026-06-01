# Build Brief: Colibrix → Google Sheets Expense Categorizer

A web app for a solo operator. Once a week, the user exports a credit-card
transactions CSV from Colibrix (a card-issuing platform) and uploads it. The app
converts every charge to USD, auto-categorizes known merchants, asks the user to
categorize anything new (and remembers the answer forever), and maintains an
accumulating ledger + a month-by-month expense summary in a Google Sheet.

**Hard constraint: Google Sheets is the ONLY datastore. No database.** The
Sheet's own tabs hold the ledger, the learned merchant→category rules, the FX
rates, and the monthly summary. This keeps everything inspectable and editable by
the user directly in Sheets.

---

## 1. Recommended stack

- **Next.js (App Router) + TypeScript**, deployable to Vercel or runnable locally.
- **Google Sheets API** via the `googleapis` package, authenticated with a
  **service account** (server-side only — the key must never reach the client).
- **PapaParse** for CSV parsing.
- No database, no ORM. All persistence is in the Google Sheet.

The business logic is stack-agnostic; if you prefer a plain Node script + a tiny
React front end, that's fine. The rules below are what matter.

A **working, validated reference implementation in Python** exists (modules
`ingest.py`, `categorize.py`, `sheets.py`). Port its logic or wrap it — every
rule in this brief is already implemented and tested there.

---

## 2. Weekly user workflow

1. User uploads the Colibrix CSV.
2. App parses it, converts to USD, filters to real expenses, and auto-categorizes
   using the learned rules.
3. Any merchant with no matching rule is shown in a **review screen**: the user
   picks a category, says whether it's a recurring subscription, and optionally
   gives it a clean name. Each answer is written back as a new rule.
4. On confirm, the app appends new transactions to the ledger (deduped), rebuilds
   the monthly summary, and refreshes the subscriptions tab.
5. User sees a summary (rows added, total this month) and a link to the Sheet.

---

## 3. Input: the Colibrix CSV

The export has **27 columns** (and a UTF-8 BOM on the first header — strip it;
read as `utf-8-sig`). Header row, then one row per transaction. Only the columns
below matter; ignore the rest.

| Column | Use |
|---|---|
| `Transaction ID` | **Dedup key.** Unique per transaction. |
| `Card Tag` | Card nickname (e.g. "Vercel GK"). **Do NOT use for merchant matching** — see Gotcha #1. |
| `PAN` | Masked card number e.g. `446619******0308`. Take **last 4** → display as `*0308`. |
| `Transaction Type` | `Presentment`, `Fee`, `Authorisation`, `Auth Reversal`. |
| `Transaction Status` | `Settled`, `Cleared`, `Declined`, `Accepted`. |
| `Status Desc`, `Note` | Free text; used to detect refunds/reversals. |
| `Amount Txn` | Original charge amount in the merchant's currency. |
| `Currency Txn` | Currency of `Amount Txn` (USD/EUR/CAD/PLN…). |
| `Reversal Amount Bill` | Non-empty (`-`/empty/`0` = empty) signals a reversal/refund. |
| `MCC`, `MCC Description` | Category hints (store `MCC Description` in the ledger). |
| `Description` | **Merchant string — the primary signal for categorization.** Messy, e.g. `PROTON* PROTON AG\\WWW.PROTON.ME\19808 DE USA`, `NAME-CHEAP.COM* FFWSBA\\WWW.NAMECHEAP\85034 AZ USA`. |
| `Date Created` | Transaction date/time. **Format is `DD/MM/YYYY HH:MM:SS` (day first).** This is the date used everywhere. |

---

## 4. Output: the Google Sheet

Sheet ID (confirm before use): `15RqqqvqARGgv76FoGZK3emqpDTVOjmcQKuiI9PHgpAg`

The app creates these tabs on first run if missing, seeding the rule/FX tabs.
The **Subscriptions** tab already exists and is curated by the user.

### 4.1 `All Transactions` (accumulating ledger)
Append-only, deduped by `Transaction ID`. Columns:
```
Transaction ID | Date (MM/DD/YYYY) | Month (YYYY-MM) | Card (*1234) | Merchant |
Description | Category | Subscription (yes/no) | MCC Desc | Amount | Currency | USD | Type
```

### 4.2 `Merchant Rules` (the learned "brain")
The merchant→category map. Seeded with the starter rules (§6), then grown by the
review flow. Columns:
```
Keyword | Category | Is Subscription (yes/no) | Display Name | Amount Anchor
```
- `Keyword`: uppercased substring matched against `Description`.
- `Display Name`: clean name used for the Subscriptions tab row.
- `Amount Anchor`: optional USD amount to disambiguate one merchant that bills
  multiple products (see Gotcha #4). Blank = no anchor.

### 4.3 `FX Rates` (user-editable, currency → USD)
```
Currency | USD Rate
```
Seed: `USD 1.0`, `EUR 1.08`, `CAD 0.73`, `PLN 0.25`. The user maintains these.

### 4.4 `Monthly Summary` (the headline output)
Recomputed from the entire `All Transactions` ledger on every run (idempotent).
Long format, one row per month × category:
```
Month (YYYY-MM) | Category | USD
```
Because it's recomputed from the full ledger each time, the **current month keeps
accumulating** across weekly uploads and **finished months stay frozen**
automatically — no special month-boundary code needed.

### 4.5 `Subscriptions` (existing tab — update in place)
Existing columns: `Service Name | Card | Card Service | Amount | Last Paid | Regularity`.
The app updates **Last Paid** for rows whose `Service Name` matches a subscription
rule's `Display Name`. It does not add or delete rows, and leaves crypto-paid rows
(which never appear in a Colibrix export) untouched.

---

## 5. Core logic (precise)

### 5.1 Which rows count as an expense
- **Count (positive expense):**
  `Transaction Type = Presentment` AND `Transaction Status = Settled`,
  OR `Transaction Type = Fee` AND `Transaction Status = Cleared`.
- **Treat as a credit (negative):** a counted row where `Note` or `Status Desc`
  contains "refund"/"reversal", OR `Reversal Amount Bill` is non-empty.
- **Exclude entirely:** `Authorisation`, `Auth Reversal`, anything `Declined`,
  and any row with `Amount Txn = 0`.
- Because authorisations are excluded, their reversals are too — never net them.

### 5.2 USD conversion
- If `Currency Txn == USD` → use `Amount Txn` as-is.
- Else → `Amount Txn × FX[Currency Txn]` using the `FX Rates` tab.
- If the currency has no rate → **skip the row and warn the user** (don't silently
  drop it). Round USD to 2 dp. Apply the negative sign for credits after conversion.

### 5.3 Dedup
Before appending, read existing `Transaction ID`s from the ledger; only append IDs
not already present. (Weekly uploads will overlap.)

### 5.4 Categorization
- **Match on `Description` ONLY** (uppercased substring contains `Keyword`).
- `Fee` transactions → category `Banking & Card Fees` by type (no rule needed).
- First matching rule wins.
- No match → `Uncategorized` → goes to the review queue.

### 5.5 Grouping unknowns for review
Group uncategorized rows by a cleaned merchant key:
`Description.split('\\')[0].split('*')[0].trim()`. One question per merchant
(not per transaction). Show example USD amounts and how many times it appeared.

### 5.6 Review questions (per unknown merchant)
1. **Category** — from the category list (§6).
2. **Recurring subscription?** — yes/no.
3. **Display name** — optional, used for the Subscriptions tab.
Each answer becomes a new row in `Merchant Rules` (`Keyword` = the merchant key,
uppercased). After saving, re-categorize so those rows leave `Uncategorized`.

### 5.7 Subscriptions upsert
For each rule with `Is Subscription = yes` and a `Display Name`:
- Find counted transactions whose `Description` contains the keyword.
- If the rule has an `Amount Anchor`, keep only txns where
  `abs(abs(usd) - anchor) <= 1.5`.
- Take the **latest by date**; if found, set `Last Paid` (MM/DD/YYYY) on the
  Subscriptions row whose `Service Name == Display Name`.
Do **not** overwrite the `Amount` column (it's the user's expected price, not the
exact charge — see Gotcha #6).

### 5.8 Monthly summary rebuild
Group the **entire** ledger by (`Month`, `Category`), sum `USD`, and overwrite the
`Monthly Summary` tab. Idempotent by design.

---

## 6. Seed data

### Categories
```
Infrastructure & Hosting
SMS, Voice & Numbers
AI & Dev APIs
Domains & DNS
Software & Productivity
Business & Compliance
Proxies & Privacy
Advertising & Growth
Banking & Card Fees
Uncategorized
```

### Starter merchant rules
`Keyword | Category | Is Subscription | Display Name | Amount Anchor`
```
VERCEL          | Infrastructure & Hosting | yes | Vercel                    |
SUPABASE        | Infrastructure & Hosting | yes | Supabase                  |
GOOGLE*CLOUD    | Infrastructure & Hosting | no  |                           |
CLOUDFLARE      | Infrastructure & Hosting | yes | Cloudflare                |
TWILIO          | SMS, Voice & Numbers     | no  |                           |
SONETEL         | SMS, Voice & Numbers     | no  |                           |
USMOBILE        | SMS, Voice & Numbers     | yes | US Mobile                 |
US MOBILE       | SMS, Voice & Numbers     | yes | US Mobile                 |
SIMPLETEXTING   | SMS, Voice & Numbers     | no  |                           |
TEXTHUB         | SMS, Voice & Numbers     | no  |                           |
MUDSHARE        | SMS, Voice & Numbers     | no  |                           |
HUSHED          | SMS, Voice & Numbers     | yes | Hushed                    |
ANTHROPIC       | AI & Dev APIs            | no  |                           |
OPENAI          | AI & Dev APIs            | no  |                           |
NAMECHEAP       | Domains & DNS            | yes | Namecheap - guidekin.com  | 11.48
NAME-CHEAP      | Domains & DNS            | yes | Namecheap - guidekin.com  | 11.48
PROTON          | Software & Productivity  | yes | Proton demmoor            |
CANVA           | Software & Productivity  | yes | Canva                     |
ANYTIMEMAILBOX  | Business & Compliance    | yes | AnytimeMailbox            |
BUSINESSNAMEREG | Business & Compliance    | no  |                           |
MGS-BUSINESS    | Business & Compliance    | no  |                           |
PINGPROXIES     | Proxies & Privacy        | yes | PingProxies               |
```

### FX seed
```
USD 1.0 | EUR 1.08 | CAD 0.73 | PLN 0.25
```

---

## 7. Web UI

Three screens, plus a settings shortcut.

1. **Upload** — drag/drop or file-pick the CSV. Show a one-line summary after
   parse: "N transactions, M counted as expenses, K need review".
2. **Review** — a card per unknown merchant: merchant name, times seen, example
   USD amounts, a **Category** dropdown, a **Subscription** toggle, and an
   optional **Name** field. An "Apply & Sync" button. If there are no unknowns,
   skip straight to confirmation.
3. **Confirmation** — rows added, rows skipped (with reason, e.g. missing FX
   rate), rules learned, the current month's category totals, and a link to the
   Sheet.

**Settings / shortcuts:** deep links to the `Merchant Rules` and `FX Rates` tabs
(editing happens in Sheets, since that's the datastore). Optionally surface the
category list for reference.

Suggested API shape (Sheets-only, server-side service account):
- `POST /api/process` — body: parsed CSV rows. Reads rules + FX from the Sheet,
  categorizes, returns `{ toAdd, unknowns, skippedNoFx, summaryPreview }`. Writes
  nothing yet.
- `POST /api/commit` — body: resolved rules + confirmed `toAdd`. Writes new rules,
  appends ledger (deduped), rebuilds summary, updates subscriptions.

---

## 8. Auth & secrets

- Google Cloud project → enable **Sheets API** + **Drive API** → create a
  **service account** → JSON key.
- Share the target Sheet with the service account's `client_email` as **Editor**.
- Store the key server-side only: a file path locally, or a base64-encoded env var
  on Vercel (`GOOGLE_SERVICE_ACCOUNT_B64`). Never expose it to the browser.

---

## 9. Gotchas (hard-won — these already bit us; don't repeat them)

1. **Match merchants on `Description` only, never `Card Tag`.** The card nickname
   "Vercel GK" caused a `GOOGLE*CLOUD` charge to falsely match a "Vercel" rule.
2. **`Date Created` is `DD/MM/YYYY` (day first).** Parsing it as US dates is wrong.
3. **The CSV has a UTF-8 BOM** on the first header — read as `utf-8-sig` or the
   first column key becomes `\ufeffTransaction ID`.
4. **One merchant can bill multiple products with identical descriptions.** There
   were four settled Namecheap charges on the same card (different domains, same
   string). "Latest charge" grabbed the wrong domain. The **Amount Anchor**
   (~$11.48 for guidekin.com) isolates the tracked one.
5. **Dedup by `Transaction ID`** — weekly uploads overlap.
6. **Don't overwrite the Subscriptions `Amount`.** It's the user's expected price
   (e.g. $5.00); the actual charge differs (e.g. $4.99 / $25 vs a noted $40).
7. **Card fees are real costs.** Include `Fee`/`Cleared` rows (small EUR amounts),
   categorized as `Banking & Card Fees`.
8. **Rebuild the monthly summary from the whole ledger each run** (idempotent) —
   this is what gives the "accumulate current month, freeze past months" behavior
   for free.

---

## 10. Acceptance tests (validated against a real May 2026 sample)

With the seed rules and FX above, processing the sample CSV must yield:

- **51** counted expenses; **0** dropped for missing FX (all USD-convertible).
- **Exactly two** merchants in the review queue: `CHATROULETTE` and `WWW.BYTEFUL.COM`.
- **May 2026 total ≈ $1,690.76**, with category breakdown approximately:
  SMS/Voice $1,452.01 · Infrastructure $65.00 · Business & Compliance $49.64 ·
  AI & Dev APIs $40.02 · Domains $35.12 · Banking & Card Fees $28.77 ·
  Uncategorized $10.65 · Software & Productivity $9.55.
- Subscriptions `Last Paid` updates: **Proton demmoor → 05/04/2026**,
  **Namecheap - guidekin.com → 05/04/2026** (the $11.48 charge, NOT the $7.68
  one on 05/25), **Vercel → 05/05/2026** (the $30 charge, NOT GOOGLE*CLOUD),
  **Supabase → 05/13/2026**.

These doubling as a test fixture is the fastest way to know the port is correct.

---

## 11. Out of scope (for now)

- Pulling transactions automatically from Colibrix (manual CSV export by design —
  the login has 2FA and scripted access is discouraged).
- Multi-user / multi-tenant. This is a single operator.
- Overdue-subscription alerts (a possible later add: flag a subscription whose
  Last Paid is older than its Regularity implies).
