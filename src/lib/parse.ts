import Papa from "papaparse";
import type { RawRow } from "./types";

/** Strip a leading UTF-8 BOM so the first header key isn't "﻿Transaction ID". */
export function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

/**
 * Parse the Colibrix CSV text into header-keyed rows.
 * Handles the UTF-8 BOM (Gotcha #3) and trims whitespace from values.
 */
export function parseCsv(text: string): RawRow[] {
  const clean = stripBom(text);
  const result = Papa.parse<RawRow>(clean, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  return (result.data ?? []).filter((r) => r && Object.keys(r).length > 0);
}

/** Read a CSV column tolerant of a stray BOM that survived on the first header. */
export function col(row: RawRow, name: string): string {
  if (name in row) return row[name] ?? "";
  const bommed = `﻿${name}`;
  if (bommed in row) return row[bommed] ?? "";
  return "";
}
