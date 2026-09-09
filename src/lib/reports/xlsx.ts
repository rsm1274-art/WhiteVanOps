// Serializes a report result to an XLSX workbook buffer. Pure module (no I/O
// beyond the in-memory workbook build, no DB).
//
// Uses exceljs, already a devDependency for the data-import engine's readers
// (src/lib/import/readers.ts) — reused here for writing rather than adding a
// second spreadsheet library.

import ExcelJS from "exceljs";
import { getField } from "./registry";
import type { RunReportResult } from "./run";

const SHEET_NAME = "Report";
const MONEY_FORMAT = "$#,##0.00";
const DATE_FORMAT = "yyyy-mm-dd";

function columnLabel(col: RunReportResult["columns"][number]): string {
  return col.label ?? getField(col.fieldKey)?.label ?? col.fieldKey;
}

function flattenArrayCell(value: unknown[]): string {
  return value
    .map((v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)))
    .join(", ");
}

/** Coerces a raw cell value to something ExcelJS can write as a typed cell:
 *  a real Date for date-typed columns, a number for numeric ones, otherwise
 *  a string. Array-valued (aggregated many-relation) cells are always
 *  flattened to a joined string regardless of the underlying field type. */
function cellValue(raw: unknown, fieldType: "string" | "number" | "date" | "boolean" | "enum" | undefined): unknown {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return flattenArrayCell(raw);
  if (fieldType === "date" && (typeof raw === "string" || raw instanceof Date)) {
    const d = raw instanceof Date ? raw : new Date(raw);
    return Number.isNaN(d.getTime()) ? String(raw) : d;
  }
  if (fieldType === "number" && typeof raw !== "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? String(raw) : n;
  }
  return raw;
}

/** Builds an in-memory XLSX workbook for a report result. Caller is
 *  responsible for serializing it (e.g. `workbook.xlsx.writeBuffer()`). */
export function toWorkbook(result: RunReportResult): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);

  const fields = result.columns.map((col) => getField(col.fieldKey));

  sheet.columns = result.columns.map((col, i) => ({
    header: columnLabel(col),
    key: col.fieldKey,
    width: Math.max(columnLabel(col).length + 2, 14),
    style: fields[i]?.sensitivity === "money" ? { numFmt: MONEY_FORMAT } : fields[i]?.type === "date" ? { numFmt: DATE_FORMAT } : undefined,
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };

  for (const row of result.rows) {
    const rowValues: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      rowValues[col.fieldKey] = cellValue(row[col.fieldKey], fields[i]?.type);
    });
    sheet.addRow(rowValues);
  }

  return workbook;
}
