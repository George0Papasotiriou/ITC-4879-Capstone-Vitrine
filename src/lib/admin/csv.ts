/**
 * Vitrine — AI-native e-shop (ITC 4949 Capstone)
 * Copyright (c) 2026 George Papasotiriou. All rights reserved.
 * Author: George Papasotiriou <g.papasotiriou@acg.edu>
 * Project started: 2026-09-12
 *
 * CSV for the admin exports: RFC 4180 quoting, a guard against spreadsheet formulas, and a byte-order mark for Excel.
 */

/**
 * Exports open in spreadsheets, and a spreadsheet runs a cell that starts
 * with "=", "+", "-" or "@" as a formula. Customer text (a name, an address)
 * could be written to do exactly that, so text cells starting with one of
 * those characters, or with a tab or carriage return, get a leading
 * apostrophe, which spreadsheets show as plain text (OWASP, "CSV injection").
 * Numbers are written as numbers and need no guard.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
/** A byte-order mark: without it Excel reads UTF-8 as a legacy code page and garbles Greek. */
const BOM = String.fromCharCode(0xfeff);

export type CsvValue = string | number | boolean | Date | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = value instanceof Date ? value.toISOString() : FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole file: header row, then one row per record, lines ended with CRLF as RFC 4180 asks. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return BOM + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Cents as a decimal amount ("1234.50") so spreadsheets can sum it. */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
