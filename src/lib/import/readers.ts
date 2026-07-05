// CSV/Excel -> uniform SourceTable for the onboarding data import engine.
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import ExcelJS from "exceljs";

export interface SourceRow {
  rowNum: number; // 1-based physical row in the file
  values: Record<string, string>;
}

export interface SourceTable {
  file: string;
  sheet?: string;
  headers: string[];
  rows: SourceRow[];
}

export function readCsv(filePath: string, headerRow = 1): SourceTable {
  const text = fs.readFileSync(filePath, "utf8");
  const noBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const parsed = Papa.parse<string[]>(noBom, { skipEmptyLines: true, delimiter: "" });
  // Filter out warnings about delimiter detection, only fail on real parse errors
  const realErrors = parsed.errors.filter((e) => !e.message.includes("auto-detect"));
  if (realErrors.length > 0) {
    throw new Error(`CSV parse error in ${filePath}: ${realErrors[0].message}`);
  }
  const lines = parsed.data;
  if (lines.length < headerRow) throw new Error(`${filePath}: header row ${headerRow} is past end of file`);
  const headers = lines[headerRow - 1].map((h) => h.trim());
  const rows: SourceRow[] = lines.slice(headerRow).map((cells, i) => ({
    rowNum: headerRow + 1 + i,
    values: Object.fromEntries(headers.map((h, c) => [h, (cells[c] ?? "").trim()])),
  }));
  return { file: path.basename(filePath), headers, rows };
}

export async function readExcel(filePath: string, headerRow = 1): Promise<SourceTable[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const tables: SourceTable[] = [];
  wb.eachSheet((ws) => {
    const headerCells = (ws.getRow(headerRow).values ?? []) as ExcelJS.CellValue[];
    const headers: string[] = [];
    // exceljs row.values is 1-indexed (index 0 is empty)
    for (let c = 1; c < headerCells.length; c++) headers.push(cellToString(headerCells[c]));
    while (headers.length > 0 && headers[headers.length - 1] === "") headers.pop();
    if (headers.length === 0) return;
    const rows: SourceRow[] = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum <= headerRow) return;
      const values: Record<string, string> = {};
      headers.forEach((h, i) => {
        values[h] = cellToString(row.getCell(i + 1).value);
      });
      rows.push({ rowNum, values });
    });
    tables.push({ file: path.basename(filePath), sheet: ws.name, headers, rows });
  });
  return tables;
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellToString(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("text" in v) return String(v.text).trim();
    return "";
  }
  return String(v).trim();
}

export async function readDataDir(
  dir: string,
  headerRows: Record<string, number> = {}
): Promise<SourceTable[]> {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(csv|xlsx)$/i.test(f))
    .sort();
  const tables: SourceTable[] = [];
  for (const f of files) {
    const full = path.join(dir, f);
    const hr = headerRows[f] ?? 1;
    if (/\.csv$/i.test(f)) tables.push(readCsv(full, hr));
    else tables.push(...(await readExcel(full, hr)));
  }
  return tables;
}
