import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import ExcelJS from "exceljs";
import { readCsv, readExcel, readDataDir } from "./readers";

const FIXTURES = path.join(__dirname, "__fixtures__");

describe("readCsv", () => {
  it("parses headers and rows with 1-based physical row numbers", () => {
    const t = readCsv(path.join(FIXTURES, "customers.csv"));
    expect(t.file).toBe("customers.csv");
    expect(t.headers).toEqual(["Customer", "Contact", "Address", "Terms"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].rowNum).toBe(2);
    expect(t.rows[0].values).toEqual({
      Customer: "Acme Plumbing", Contact: "Jane Doe", Address: "12 Main St", Terms: "Net 30",
    });
  });

  it("handles quoted fields with commas and trims cells", () => {
    const p = path.join(os.tmpdir(), `wvo-readers-${Date.now()}.csv`);
    fs.writeFileSync(p, 'Name,Notes\n" Acme, Inc. ","  hi  "\n');
    const t = readCsv(p);
    expect(t.rows[0].values).toEqual({ Name: "Acme, Inc.", Notes: "hi" });
    fs.unlinkSync(p);
  });

  it("respects headerRow > 1", () => {
    const p = path.join(os.tmpdir(), `wvo-readers-h-${Date.now()}.csv`);
    fs.writeFileSync(p, "junk line\nName,Qty\nWidget,3\n");
    const t = readCsv(p, 2);
    expect(t.headers).toEqual(["Name", "Qty"]);
    expect(t.rows[0]).toEqual({ rowNum: 3, values: { Name: "Widget", Qty: "3" } });
    fs.unlinkSync(p);
  });
});

describe("readExcel", () => {
  it("reads sheets, stringifies cells, formats dates as YYYY-MM-DD", async () => {
    const p = path.join(os.tmpdir(), `wvo-readers-${Date.now()}.xlsx`);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Jobs");
    ws.addRow(["Job", "Date", "Qty"]);
    ws.addRow(["J-1", new Date(Date.UTC(2026, 6, 10)), 3]);
    await wb.xlsx.writeFile(p);
    const tables = await readExcel(p);
    expect(tables).toHaveLength(1);
    expect(tables[0].sheet).toBe("Jobs");
    expect(tables[0].headers).toEqual(["Job", "Date", "Qty"]);
    expect(tables[0].rows[0].values).toEqual({ Job: "J-1", Date: "2026-07-10", Qty: "3" });
    fs.unlinkSync(p);
  });
});

describe("readDataDir", () => {
  it("reads every csv in a directory, sorted by filename", async () => {
    const tables = await readDataDir(FIXTURES);
    expect(tables.map((t) => t.file)).toEqual(["customers.csv", "jobs.csv", "vehicles.csv"]);
  });
});
