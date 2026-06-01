import type { FxRates, Rule } from "./types";

/** The Google Sheet ID — the only datastore. Overridable via SHEET_ID env. */
export const DEFAULT_SHEET_ID = "15RqqqvqARGgv76FoGZK3emqpDTVOjmcQKuiI9PHgpAg";

export const FEE_CATEGORY = "Banking & Card Fees";
export const UNCATEGORIZED = "Uncategorized";

/** Category list (§6). */
export const CATEGORIES: string[] = [
  "Infrastructure & Hosting",
  "SMS, Voice & Numbers",
  "AI & Dev APIs",
  "Domains & DNS",
  "Software & Productivity",
  "Business & Compliance",
  "Proxies & Privacy",
  "Advertising & Growth",
  FEE_CATEGORY,
  UNCATEGORIZED,
];

/** Starter merchant rules (§6). */
export const SEED_RULES: Rule[] = [
  { keyword: "VERCEL", category: "Infrastructure & Hosting", isSubscription: true, displayName: "Vercel", amountAnchor: null },
  { keyword: "SUPABASE", category: "Infrastructure & Hosting", isSubscription: true, displayName: "Supabase", amountAnchor: null },
  { keyword: "GOOGLE*CLOUD", category: "Infrastructure & Hosting", isSubscription: false, displayName: "", amountAnchor: null },
  { keyword: "CLOUDFLARE", category: "Infrastructure & Hosting", isSubscription: true, displayName: "Cloudflare", amountAnchor: null },
  { keyword: "TWILIO", category: "SMS, Voice & Numbers", isSubscription: false, displayName: "", amountAnchor: null },
  { keyword: "SONETEL", category: "SMS, Voice & Numbers", isSubscription: false, displayName: "", amountAnchor: null },
  { keyword: "USMOBILE", category: "SMS, Voice & Numbers", isSubscription: true, displayName: "US Mobile", amountAnchor: null },
  { keyword: "US MOBILE", category: "SMS, Voice & Numbers", isSubscription: true, displayName: "US Mobile", amountAnchor: null },
  { keyword: "SIMPLETEXTING", category: "SMS, Voice & Numbers", isSubscription: false, displayName: "", amountAnchor: null },
  { keyword: "TEXTHUB", category: "SMS, Voice & Numbers", isSubscription: false, displayName: "", amountAnchor: null },
  { keyword: "MUDSHARE", category: "SMS, Voice & Numbers", isSubscription: false, displayName: "", amountAnchor: null },
  { keyword: "HUSHED", category: "SMS, Voice & Numbers", isSubscription: true, displayName: "Hushed", amountAnchor: null },
  { keyword: "ANTHROPIC", category: "AI & Dev APIs", isSubscription: false, displayName: "", amountAnchor: null },
  { keyword: "OPENAI", category: "AI & Dev APIs", isSubscription: false, displayName: "", amountAnchor: null },
  { keyword: "NAMECHEAP", category: "Domains & DNS", isSubscription: true, displayName: "Namecheap - guidekin.com", amountAnchor: 11.48 },
  { keyword: "NAME-CHEAP", category: "Domains & DNS", isSubscription: true, displayName: "Namecheap - guidekin.com", amountAnchor: 11.48 },
  { keyword: "PROTON", category: "Software & Productivity", isSubscription: true, displayName: "Proton demmoor", amountAnchor: null },
  { keyword: "CANVA", category: "Software & Productivity", isSubscription: true, displayName: "Canva", amountAnchor: null },
  { keyword: "ANYTIMEMAILBOX", category: "Business & Compliance", isSubscription: true, displayName: "AnytimeMailbox", amountAnchor: null },
  { keyword: "BUSINESSNAMEREG", category: "Business & Compliance", isSubscription: false, displayName: "", amountAnchor: null },
  { keyword: "MGS-BUSINESS", category: "Business & Compliance", isSubscription: false, displayName: "", amountAnchor: null },
  { keyword: "PINGPROXIES", category: "Proxies & Privacy", isSubscription: true, displayName: "PingProxies", amountAnchor: null },
];

/** FX seed (§6). */
export const SEED_FX: FxRates = {
  USD: 1.0,
  EUR: 1.08,
  CAD: 0.73,
  PLN: 0.25,
};

// --- Tab names ---
export const TAB_LEDGER = "All Transactions";
export const TAB_RULES = "Merchant Rules";
export const TAB_FX = "FX Rates";
export const TAB_SUMMARY = "Monthly Summary";
export const TAB_SUBSCRIPTIONS = "Subscriptions";

export const LEDGER_HEADER = [
  "Transaction ID",
  "Date",
  "Month",
  "Card",
  "Merchant",
  "Description",
  "Category",
  "Subscription",
  "MCC Desc",
  "Amount",
  "Currency",
  "USD",
  "Type",
];

export const RULES_HEADER = ["Keyword", "Category", "Is Subscription", "Display Name", "Amount Anchor"];
export const FX_HEADER = ["Currency", "USD Rate"];
export const SUMMARY_HEADER = ["Month", "Category", "USD"];
