// Dev helper: POST the sample CSV to /api/process or /api/commit and print JSON.
// Usage: node scripts/run.mjs process
//        node scripts/run.mjs commit '<answers-json>'
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mode = process.argv[2] || "process";
const base = process.env.BASE_URL || "http://localhost:3000";
const csv = readFileSync(resolve(process.cwd(), "samples/card-transactions.csv"), "utf-8");

const procRes = await fetch(`${base}/api/process`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ csv }),
});
const proc = await procRes.json();

if (mode === "process") {
  console.log(JSON.stringify(proc, null, 2));
  process.exit(procRes.ok ? 0 : 1);
}

// commit: pass answers as argv[3] JSON (defaults to the two known unknowns)
const answers = process.argv[3]
  ? JSON.parse(process.argv[3])
  : [
      { merchantKey: "CHATROULETTE", category: "Software & Productivity", isSubscription: false, displayName: "" },
      { merchantKey: "WWW.BYTEFUL.COM", category: "Software & Productivity", isSubscription: false, displayName: "" },
    ];

const commitRes = await fetch(`${base}/api/commit`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ toAdd: proc.toAdd, answers }),
});
const commit = await commitRes.json();
console.log(JSON.stringify(commit, null, 2));
process.exit(commitRes.ok ? 0 : 1);
