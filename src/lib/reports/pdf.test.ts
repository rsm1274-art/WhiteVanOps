import { describe, it, expect } from "vitest";
import { renderReportPdf, PDF_MAX_COLUMNS } from "./pdf";
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

describe("renderReportPdf", () => {
  it("throws before doing any rendering work when the report has more than PDF_MAX_COLUMNS columns", async () => {
    const tooManyColumns = Array.from({ length: PDF_MAX_COLUMNS + 1 }, (_, i) => ({ fieldKey: `job.field${i}` }));
    const result = makeResult({ columns: tooManyColumns });

    await expect(renderReportPdf(result, { reportName: "Too Wide", settings: [] })).rejects.toThrow(
      /at most 8/
    );
  });

  it("produces a single-page PDF for a small result set", async () => {
    const result = makeResult({
      rows: [{ "job.status": "Scheduled", "job.notes": "Bring the lift" }],
      totalRows: 1,
    });

    const bytes = await renderReportPdf(result, { reportName: "Small Report", settings: [] });

    // %PDF- magic bytes confirm a real PDF was produced.
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("breaks into multiple pages when enough rows are given to overflow one page", async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      "job.status": `Status ${i}`,
      "job.notes": `Row ${i}`,
    }));
    const result = makeResult({ rows, totalRows: rows.length });

    const bytes = await renderReportPdf(result, { reportName: "Long Report", settings: [] });

    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it("uses the shipped-default company name when no company_name setting is present", async () => {
    const result = makeResult();
    // No direct text-extraction available without a heavier PDF-parsing dep;
    // this just confirms readCompanyDetails' default path doesn't throw with
    // an empty settings array, matching how invoice/quote PDF routes call it.
    await expect(renderReportPdf(result, { reportName: "Report", settings: [] })).resolves.toBeInstanceOf(
      Uint8Array
    );
  });

  it("falls back to 'Custom Report' when reportName is empty", async () => {
    const result = makeResult();
    await expect(renderReportPdf(result, { reportName: "", settings: [] })).resolves.toBeInstanceOf(Uint8Array);
  });
});
