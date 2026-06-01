// Prints the environment variables to paste into Vercel (Project -> Settings ->
// Environment Variables). Run locally:  node scripts/print-env.mjs
// Secrets are read from your local oauth_client.json / .google-token.json and
// printed ONLY to your terminal.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const clientPath = resolve(root, "oauth_client.json");
const tokenPath = resolve(root, ".google-token.json");

if (!existsSync(clientPath) || !existsSync(tokenPath)) {
  console.error("Missing oauth_client.json or .google-token.json. Run `npm run authorize` first.");
  process.exit(1);
}

const clientB64 = Buffer.from(readFileSync(clientPath)).toString("base64");
const token = JSON.parse(readFileSync(tokenPath, "utf-8"));
const sheetId = process.env.SHEET_ID || "15RqqqvqARGgv76FoGZK3emqpDTVOjmcQKuiI9PHgpAg";

if (!token.refresh_token) {
  console.error("No refresh_token in .google-token.json. Re-run `npm run authorize`.");
  process.exit(1);
}

console.log("\nPaste these into Vercel -> Settings -> Environment Variables (all Environments):\n");
console.log("SHEET_ID");
console.log(sheetId + "\n");
console.log("GOOGLE_OAUTH_CLIENT_B64");
console.log(clientB64 + "\n");
console.log("GOOGLE_REFRESH_TOKEN");
console.log(token.refresh_token + "\n");
console.log("APP_PASSWORD");
console.log("<choose a strong password — this is what you'll type to log in>\n");
