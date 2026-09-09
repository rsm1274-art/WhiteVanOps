import { describe, it, expect } from "vitest";
import { toCsv } from "./csv";
import type { RunReportResult } from "./run";

function makeResult(overrides: Partial<RunReportResult> = {}): RunReportResult {
  return {
    columns: [{ fieldKey: "job.status" }, { fieldKey: "job.notes" }],
    rows: [],
    totalRows: 0,
    truncated: false,
    ...overrides,
  };
}

describe("toCsv", () => {
  it("renders a header row using the registry label and one data row per result row", () => {
    const result = makeResult({
      rows: [{ "job.status": "Scheduled", "job.notes": "Bring the lift" }],
      totalRows: 1,
    });

    const csv = toCsv(result);

    expect(csv).toContain("Job Status");
    expect(csv).toContain("Scheduled,Bring the lift");
  });

  it("uses a column's explicit label override instead of the registry label when present", () => {
    const result = makeResult({
      columns: [{ fieldKey: "job.status", label: "Current Stage" }],
      rows: [{ "job.status": "Scheduled" }],
      totalRows: 1,
    });

    const csv = toCsv(result);

    expect(csv).toContain("Current Stage");
    expect(csv).not.toContain("Job Status");
  });

  it("falls back to the raw field key when no registry entry or override exists", () => {
    const result = makeResult({
      columns: [{ fieldKey: "unregistered.field" }],
      rows: [{ "unregistered.field": "x" }],
      totalRows: 1,
    });

    expect(toCsv(result)).toContain("unregistered.field");
  });

  it("prefixes a cell beginning with =, +, -, or @ with a leading apostrophe to defuse formula injection", () => {
    const result = makeResult({
      columns: [{ fieldKey: "job.notes" }],
      rows: [
        { "job.notes": "=SUM(A1:A9)" },
        { "job.notes": "+1 555 0100" },
        { "job.notes": "-1" },
        { "job.notes": "@mention" },
        { "job.notes": "safe text" },
      ],
      totalRows: 5,
    });

    const lines = toCsv(result).split("\r\n").slice(1);

    expect(lines[0]).toBe("'=SUM(A1:A9)");
    expect(lines[1]).toBe("'+1 555 0100");
    expect(lines[2]).toBe("'-1");
    expect(lines[3]).toBe("'@mention");
    expect(lines[4]).toBe("safe text");
  });

  it("flattens an array-valued (aggregated many-relation) cell into a comma-joined string", () => {
    const result = makeResult({
      columns: [{ fieldKey: "personnel.firstName", aggregation: "list" }],
      rows: [{ "personnel.firstName": ["Alice", "Bob", null] }],
      totalRows: 1,
    });

    const lines = toCsv(result).split("\r\n");

    expect(lines[1]).toBe('"Alice, Bob, "');
  });

  it("renders an empty string for null and undefined cell values", () => {
    const result = makeResult({
      columns: [{ fieldKey: "job.status" }],
      rows: [{ "job.status": null }, { "job.status": undefined }],
      totalRows: 2,
    });

    const lines = toCsv(result).split("\r\n").slice(1);

    expect(lines[0]).toBe("");
    expect(lines[1]).toBe("");
  });
});
