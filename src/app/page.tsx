"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CATEGORIES, DEFAULT_SHEET_ID } from "@/lib/seed";
import type { ProcessResult, ReviewAnswer, SummaryRow } from "@/lib/types";

type Stage = "upload" | "review" | "confirm";

interface CommitResult {
  rowsAdded: number;
  rowsSkippedDuplicate: number;
  rulesLearned: string[];
  subscriptionsUpdated: string[];
  currentMonth: string;
  currentMonthTotals: SummaryRow[];
  sheetUrl: string;
}

const sheetUrl = `https://docs.google.com/spreadsheets/d/${DEFAULT_SHEET_ID}/edit`;

export default function Page() {
  const [stage, setStage] = useState<Stage>("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proc, setProc] = useState<ProcessResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, ReviewAnswer>>({});
  const [commit, setCommit] = useState<CommitResult | null>(null);
  const [fileName, setFileName] = useState<string>("");

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setBusy(true);
    setFileName(file.name);
    try {
      const csv = await file.text();
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Processing failed");
      const result = data as ProcessResult;
      setProc(result);
      // Seed default answers (first category) for each unknown.
      const seed: Record<string, ReviewAnswer> = {};
      for (const u of result.unknowns) {
        seed[u.merchantKey] = {
          merchantKey: u.merchantKey,
          category: CATEGORIES[0],
          isSubscription: false,
          displayName: "",
        };
      }
      setAnswers(seed);
      if (result.unknowns.length > 0) {
        setStage("review");
      } else {
        // No unknowns — skip straight to commit + confirmation (§7).
        await doCommit(result, {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doCommit(result: ProcessResult, ans: Record<string, ReviewAnswer>) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toAdd: result.toAdd, answers: Object.values(ans) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Commit failed");
      setCommit(data as CommitResult);
      setStage("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStage("upload");
    setProc(null);
    setAnswers({});
    setCommit(null);
    setError(null);
    setFileName("");
  }

  return (
    <div className="wrap">
      <h1>Colibrix Expense Categorizer</h1>
      <p className="sub">
        Upload the weekly Colibrix CSV → categorize → sync to{" "}
        <a href={sheetUrl} target="_blank" rel="noreferrer">
          Google Sheets
        </a>
        .
      </p>

      <Steps stage={stage} />

      {error && <div className="error">⚠ {error}</div>}

      {stage === "upload" && <Upload busy={busy} onFile={handleFile} fileName={fileName} />}

      {stage === "review" && proc && (
        <Review
          proc={proc}
          answers={answers}
          setAnswers={setAnswers}
          busy={busy}
          onApply={() => doCommit(proc, answers)}
        />
      )}

      {stage === "confirm" && commit && (
        <Confirm commit={commit} proc={proc} onReset={reset} />
      )}

      {busy && stage === "upload" && <p className="muted">Processing…</p>}
    </div>
  );
}

function Steps({ stage }: { stage: Stage }) {
  const order: { key: Stage; label: string }[] = [
    { key: "upload", label: "1 · Upload" },
    { key: "review", label: "2 · Review" },
    { key: "confirm", label: "3 · Confirm" },
  ];
  return (
    <div className="steps">
      {order.map((s) => (
        <span key={s.key} className={`step ${s.key === stage ? "active" : ""}`}>
          {s.label}
        </span>
      ))}
    </div>
  );
}

function Upload({
  busy,
  onFile,
  fileName,
}: {
  busy: boolean;
  onFile: (f: File) => void;
  fileName: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  return (
    <div className="panel">
      <div
        className={`dropzone ${drag ? "drag" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
      >
        <div className="big">{busy ? "Processing…" : "Drop the Colibrix CSV here"}</div>
        <div className="muted">or click to choose a file</div>
        {fileName && <div className="muted" style={{ marginTop: 8 }}>{fileName}</div>}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </div>
    </div>
  );
}

function Review({
  proc,
  answers,
  setAnswers,
  busy,
  onApply,
}: {
  proc: ProcessResult;
  answers: Record<string, ReviewAnswer>;
  setAnswers: (a: Record<string, ReviewAnswer>) => void;
  busy: boolean;
  onApply: () => void;
}) {
  function update(key: string, patch: Partial<ReviewAnswer>) {
    setAnswers({ ...answers, [key]: { ...answers[key], ...patch } });
  }

  return (
    <>
      <div className="panel">
        <div className="summary-line">
          <strong>{proc.stats.parsed}</strong> transactions ·{" "}
          <strong>{proc.stats.counted}</strong> counted as expenses ·{" "}
          <strong>{proc.unknowns.length}</strong> need review
          {proc.skippedNoFx.length > 0 && (
            <>
              {" "}
              · <span className="pill warn">{proc.skippedNoFx.length} skipped (no FX)</span>
            </>
          )}
        </div>
      </div>

      {proc.unknowns.map((u) => {
        const a = answers[u.merchantKey];
        return (
          <div className="card" key={u.merchantKey}>
            <div className="mname">{u.merchantKey}</div>
            <div className="meta">
              seen {u.count}× · example USD: {u.exampleUsd.map((v) => `$${v.toFixed(2)}`).join(", ")}
            </div>
            <div className="row">
              <div className="field">
                <label>Category</label>
                <select
                  value={a?.category ?? CATEGORIES[0]}
                  onChange={(e) => update(u.merchantKey, { category: e.target.value })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Recurring subscription?</label>
                <span className="toggle">
                  <input
                    type="checkbox"
                    checked={a?.isSubscription ?? false}
                    onChange={(e) => update(u.merchantKey, { isSubscription: e.target.checked })}
                  />
                  <span className="muted">{a?.isSubscription ? "yes" : "no"}</span>
                </span>
              </div>
              <div className="field" style={{ flex: 1, minWidth: 200 }}>
                <label>Display name (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Chatroulette"
                  value={a?.displayName ?? ""}
                  onChange={(e) => update(u.merchantKey, { displayName: e.target.value })}
                />
              </div>
            </div>
          </div>
        );
      })}

      <div className="actions">
        <button className="primary" disabled={busy} onClick={onApply}>
          {busy ? "Syncing…" : "Apply & Sync"}
        </button>
      </div>
    </>
  );
}

function Confirm({
  commit,
  proc,
  onReset,
}: {
  commit: CommitResult;
  proc: ProcessResult | null;
  onReset: () => void;
}) {
  const total = useMemo(
    () => commit.currentMonthTotals.reduce((s, r) => s + r.usd, 0),
    [commit.currentMonthTotals]
  );
  return (
    <>
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="muted">Rows added to ledger</div>
            <div className="big-total">{commit.rowsAdded}</div>
          </div>
          <div>
            <div className="muted">{commit.currentMonth} total</div>
            <div className="big-total">${total.toFixed(2)}</div>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          {commit.rowsSkippedDuplicate > 0 && (
            <span className="pill">{commit.rowsSkippedDuplicate} duplicate(s) skipped</span>
          )}
          {proc && proc.skippedNoFx.length > 0 && (
            <span className="pill warn">{proc.skippedNoFx.length} skipped (missing FX rate)</span>
          )}
          {commit.rulesLearned.length > 0 && (
            <span className="pill good">{commit.rulesLearned.length} rule(s) learned</span>
          )}
        </div>
      </div>

      {commit.currentMonthTotals.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{commit.currentMonth} by category</h3>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">USD</th>
              </tr>
            </thead>
            <tbody>
              {commit.currentMonthTotals.map((r) => (
                <tr key={r.category}>
                  <td>{r.category}</td>
                  <td className="num">${r.usd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {commit.subscriptionsUpdated.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Subscriptions updated</h3>
          <div className="muted">{commit.subscriptionsUpdated.join(", ")}</div>
        </div>
      )}

      {proc && proc.skippedNoFx.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Skipped — missing FX rate</h3>
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Currency</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {proc.skippedNoFx.map((s) => (
                <tr key={s.transactionId}>
                  <td>{s.description}</td>
                  <td>{s.currency}</td>
                  <td className="num">{s.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Add the missing rate(s) to the <strong>FX Rates</strong> tab, then re-upload.
          </p>
        </div>
      )}

      <div className="actions">
        <a href={commit.sheetUrl} target="_blank" rel="noreferrer">
          <button className="primary">Open the Google Sheet ↗</button>
        </a>
        <button onClick={onReset}>Process another file</button>
      </div>
    </>
  );
}
