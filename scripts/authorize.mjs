// One-time OAuth consent for the desktop client in oauth_client.json.
// Run: npm run authorize
// Opens a Google consent page, captures the redirect on a loopback port, and
// saves the refresh token to .google-token.json (git-ignored). The Next app
// then reads that token via src/lib/sheets.ts -> makeOAuthClient().

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { exec } from "node:child_process";
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const PORT = Number(process.env.AUTH_PORT || 5599);
const REDIRECT = `http://localhost:${PORT}`;

const CLIENT_PATH = process.env.GOOGLE_OAUTH_CLIENT_PATH || resolve(process.cwd(), "oauth_client.json");
const TOKEN_PATH = process.env.GOOGLE_TOKEN_PATH || resolve(process.cwd(), ".google-token.json");

if (!existsSync(CLIENT_PATH)) {
  console.error(`✗ oauth_client.json not found at ${CLIENT_PATH}`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(CLIENT_PATH, "utf-8"));
const conf = raw.installed || raw.web;
if (!conf) {
  console.error("✗ oauth_client.json has no `installed`/`web` block.");
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(conf.client_id, conf.client_secret, REDIRECT);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // force a refresh_token even on re-auth
  scope: SCOPES,
});

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, REDIRECT);
    const code = url.searchParams.get("code");
    const err = url.searchParams.get("error");
    if (err) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`<h2>Authorization failed: ${err}</h2>`);
      return;
    }
    if (!code) {
      res.writeHead(400);
      res.end("Missing ?code");
      return;
    }
    const { tokens } = await oAuth2Client.getToken(code);
    writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<h2>✓ Authorized.</h2><p>Token saved. You can close this tab and return to the terminal.</p>"
    );
    console.log(`\n✓ Token saved to ${TOKEN_PATH}`);
    if (!tokens.refresh_token) {
      console.warn(
        "⚠ No refresh_token returned. Revoke the app at https://myaccount.google.com/permissions and re-run."
      );
    }
    setTimeout(() => server.close(() => process.exit(0)), 300);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h2>Token exchange failed</h2><pre>${e?.message ?? e}</pre>`);
    console.error("✗ Token exchange failed:", e?.message ?? e);
    setTimeout(() => server.close(() => process.exit(1)), 300);
  }
});

server.listen(PORT, () => {
  console.log("\n1. Open this URL in a browser signed in to the Google account that owns the Sheet:\n");
  console.log("   " + authUrl + "\n");
  console.log(`2. Approve access. The page will redirect to ${REDIRECT} and the token will be saved.\n`);
  // Best-effort auto-open (Windows / macOS / Linux).
  const opener =
    process.platform === "win32" ? `start "" "${authUrl}"` :
    process.platform === "darwin" ? `open "${authUrl}"` :
    `xdg-open "${authUrl}"`;
  exec(opener, () => {});
});
