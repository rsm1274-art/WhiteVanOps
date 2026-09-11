// Serializes a report result to CSV. Pure module: no I/O, no DB.
//
// Two things this MUST do, both because report output can include free-text
// fields (Job.notes and similar) straight from customer data:
//   1. Flatten array-valued (many/aggregated) cells to a readable string —
//      Papa.unparse would otherwise stringify them as "[object Object]"-style
//      JSON.
//   2. Defuse spreadsheet formula injection: a cell whose text begins with
//      =, +, -, or @ is interpreted as a formula by Excel/Sheets on open. A
//      leading apostrophe forces it to render as literal text instead.

import Papa from "papaparse";
import { getField } from "./registry";
import type { RunReportResult } from "./run";

/** Same fallback chain PreviewTable.tsx uses: explicit override, then the
 *  registry's label, then the raw key as a last resort. */
function columnLabel(col: RunReportResult["columns"][number]): string {
  return col.label ?? getField(col.fieldKey)?.label ?? col.fieldKey;
}

const FORMULA_TRIGGER_CHARS = ["=", "+", "-", "@"];

function flattenCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value
      .map((v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)))
      .join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function defuseFormula(cell: string): string {
  return FORMULA_TRIGGER_CHARS.includes(cell.charAt(0)) ? `'${cell}` : cell;
}

/** Converts a report result into CSV text, safe to write directly to a response body. */
export function toCsv(result: RunReportResult): string {
  const headers = result.columns.map(columnLabel);
  const rows = result.rows.map((row) =>
    result.columns.map((col) => defuseFormula(flattenCell(row[col.fieldKey])))
  );
  return Papa.unparse({ fields: headers, data: rows });
}
