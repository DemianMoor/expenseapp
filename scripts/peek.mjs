// Dev helper: read a range and print it. Usage: node scripts/peek.mjs "Payments!A1:Z5"
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { google } from "googleapis";

const range = process.argv[2] || "Payments!A1:Z5";
const SHEET_ID = process.env.SHEET_ID || "15RqqqvqARGgv76FoGZK3emqpDTVOjmcQKuiI9PHgpAg";

const conf = JSON.parse(readFileSync(resolve(process.cwd(), "oauth_client.json"), "utf-8")).installed;
const token = JSON.parse(readFileSync(resolve(process.cwd(), ".google-token.json"), "utf-8"));
const auth = new google.auth.OAuth2(conf.client_id, conf.client_secret, "http://localhost:5599");
auth.setCredentials(token);

const sheets = google.sheets({ version: "v4", auth });
const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
console.log(JSON.stringify(res.data.values ?? [], null, 2));
