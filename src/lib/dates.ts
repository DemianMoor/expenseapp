// Date helpers. CRITICAL: Colibrix `Date Created` is DD/MM/YYYY HH:MM:SS (day first).

/**
 * Parse a Colibrix `Date Created` value: "DD/MM/YYYY HH:MM:SS" (day first).
 * Returns null if it cannot be parsed.
 */
export function parseDayFirst(value: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const m = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const hour = Number(m[4] ?? "0");
  const min = Number(m[5] ?? "0");
  const sec = Number(m[6] ?? "0");
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Use UTC to avoid timezone shifting the calendar day.
  const d = new Date(Date.UTC(year, month - 1, day, hour, min, sec));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Format a Date as MM/DD/YYYY (US display, used in the ledger & Subscriptions). */
export function formatMMDDYYYY(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/** Format a Date as YYYY-MM (the month bucket). */
export function formatMonth(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}
