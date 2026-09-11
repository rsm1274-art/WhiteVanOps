import { describe, it, expect } from "vitest";
import { toWorkbook } from "./xlsx";
import type { RunReportResult } from "./run";

function makeResult(overrides: Partial<RunReportResult> = {}): RunReportResult {
  return {
    columns: [{ fieldKey: "job.status" }],
    rows: [],
    totalRows: 0,
    truncated: false,
    ...overrides,
  };
}

describe("toWorkbook", () => {
  it("produces a single sheet named 'Report' with a bold header row of registry labels", () => {
    const wb = toWorkbook(makeResult({ columns: [{ fieldKey: "job.status" }, { fieldKey: "job.notes" }] }));

    expect(wb.worksheets).toHaveLength(1);
    const sheet = wb.getWorksheet("Report");
    expect(sheet).toBeDefined();
    expect(sheet!.getRow(1).getCell(1).value).toBe("Job Status");
    expect(sheet!.getRow(1).getCell(2).value).toBe("Job Notes");
    expect(sheet!.getRow(1).font?.bold).toBe(true);
  });

  it("writes one row per result row, in order", () => {
    const wb = toWorkbook(
      makeResult({
        rows: [{ "job.status": "Scheduled" }, { "job.status": "Completed" }],
        totalRows: 2,
      })
    );

    const sheet = wb.getWorksheet("Report")!;
    expect(sheet.rowCount).toBe(3); // header + 2 data rows
    expect(sheet.getRow(2).getCell(1).value).toBe("Scheduled");
    expect(sheet.getRow(3).getCell(1).value).toBe("Completed");
  });

  it("writes a date-typed field as a real Date cell, not a string", () => {
    const wb = toWorkbook(
      makeResult({
        columns: [{ fieldKey: "job.scheduledDate" }],
        rows: [{ "job.scheduledDate": "2026-09-15T00:00:00.000Z" }],
        totalRows: 1,
      })
    );

    const cellValue = wb.getWorksheet("Report")!.getRow(2).getCell(1).value;
    expect(cellValue).toBeInstanceOf(Date);
  });

  it("applies a currency number format to a column whose registry field is money-sensitive", () => {
    const wb = toWorkbook(makeResult({ columns: [{ fieldKey: "lineItem.rate" }] }));

    const col = wb.getWorksheet("Report")!.getColumn(1);
    expect(col.style?.numFmt).toBe("$#,##0.00");
  });

  it("flattens an array-valued (aggregated many-relation) cell to a joined string", () => {
    const wb = toWorkbook(
      makeResult({
        columns: [{ fieldKey: "personnel.firstName", aggregation: "list" }],
        rows: [{ "personnel.firstName": ["Alice", "Bob"] }],
        totalRows: 1,
      })
    );

    expect(wb.getWorksheet("Report")!.getRow(2).getCell(1).value).toBe("Alice, Bob");
  });

  it("uses the raw field key as the header when no registry entry exists", () => {
    const wb = toWorkbook(makeResult({ columns: [{ fieldKey: "unregistered.field" }] }));

    expect(wb.getWorksheet("Report")!.getRow(1).getCell(1).value).toBe("unregistered.field");
  });
});
