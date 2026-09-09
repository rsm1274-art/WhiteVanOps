// Renders a report result as a landscape-Letter, paginated PDF. Uses the
// additive createPaginatedCanvas from src/lib/pdfDoc.ts — invoice/quote PDFs
// keep using the original single-page createDocCanvas and are untouched.

import {
  LEFT,
  MARGIN,
  MUTED,
  ZINC,
  createPaginatedCanvas,
  readCompanyDetails,
  truncate,
} from "@/lib/pdfDoc";
import { formatDate } from "@/lib/dateUtils";
import { getField } from "./registry";
import type { RunReportResult } from "./run";

/** Beyond this many columns, cells get too narrow to read on a Letter page —
 *  the export route checks this before calling into pdf.ts and returns a
 *  400 instead of producing a garbled table. */
export const PDF_MAX_COLUMNS = 8;

// Landscape Letter: pdfDoc.ts's PAGE_WIDTH/PAGE_HEIGHT swap under
// `landscape: true`, so the usable page is PAGE_HEIGHT wide x PAGE_WIDTH
// tall. Hardcoded here (rather than imported and swapped) to keep this
// module's layout math self-contained and easy to read top to bottom.
const PAGE_W = 792;
const PAGE_H = 612;

const DATA_ROW_HEIGHT = 16;
const CELL_FONT_SIZE = 8;
const HEADER_FONT_SIZE = 8;

function columnLabel(col: RunReportResult["columns"][number]): string {
  return col.label ?? getField(col.fieldKey)?.label ?? col.fieldKey;
}

function flattenCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((v) => (v === null || v === undefined ? "" : String(v))).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

interface ColumnLayout {
  label: string;
  x: number;
  width: number;
}

function computeColumnLayout(columns: RunReportResult["columns"]): ColumnLayout[] {
  const usableWidth = PAGE_W - 2 * MARGIN;
  const colWidth = usableWidth / columns.length;
  return columns.map((col, i) => ({
    label: columnLabel(col),
    x: MARGIN + i * colWidth,
    width: colWidth,
  }));
}

function charsForWidth(width: number, size: number): number {
  // Helvetica averages ~0.5em per character; leave a little breathing room.
  return Math.max(4, Math.floor(width / (size * 0.55)));
}

export interface RenderReportPdfOptions {
  reportName: string;
  settings: { key: string; value: string }[];
}

/**
 * Builds the PDF and returns its bytes. Throws if `result.columns.length`
 * exceeds PDF_MAX_COLUMNS — callers should check that first (the export
 * route does, so it can return a clean 400 instead of a thrown 500).
 */
export async function renderReportPdf(result: RunReportResult, opts: RenderReportPdfOptions): Promise<Uint8Array> {
  if (result.columns.length > PDF_MAX_COLUMNS) {
    throw new Error(
      `Report has ${result.columns.length} columns; PDF export supports at most ${PDF_MAX_COLUMNS}. Narrow the report or use CSV/XLSX instead.`
    );
  }

  const company = readCompanyDetails(opts.settings);
  const layout = computeColumnLayout(result.columns);
  const canvas = await createPaginatedCanvas({ landscape: true });

  /** Draws the repeating column-header row at `startY`; returns the y to
   *  resume drawing data rows at. */
  const drawTableHeader = (startY: number): number => {
    let y = startY;
    for (const col of layout) {
      canvas.text(col.label, col.x, y, { font: canvas.bold, size: HEADER_FONT_SIZE, color: MUTED });
    }
    y -= 6;
    canvas.hr(y);
    return y - 10;
  };

  // Page-one masthead: company name, report name, generated-on line.
  let y = PAGE_H - MARGIN;
  canvas.text(company.name, LEFT, y, { font: canvas.bold, size: 16 });
  canvas.text(opts.reportName || "Custom Report", PAGE_W - MARGIN, y, { font: canvas.bold, size: 16, alignRight: true });
  y -= 16;
  canvas.text(`Generated on ${formatDate(new Date().toISOString())}`, LEFT, y, { size: 9, color: MUTED });
  y -= 18;
  canvas.hr(y);
  y -= 20;
  y = drawTableHeader(y);

  for (const row of result.rows) {
    const pageBefore = canvas.page;
    y = canvas.ensureSpace(y, DATA_ROW_HEIGHT);
    if (canvas.page !== pageBefore) {
      // ensureSpace only repositions y to the fresh page's top margin — the
      // repeating header still has to be (re)drawn explicitly on every
      // break, same as on page one above.
      y = drawTableHeader(y);
    }
    for (const [i, col] of result.columns.entries()) {
      const text = truncate(flattenCell(row[col.fieldKey]), charsForWidth(layout[i].width, CELL_FONT_SIZE));
      canvas.text(text, layout[i].x, y, { size: CELL_FONT_SIZE, color: ZINC });
    }
    y -= DATA_ROW_HEIGHT;
  }

  const pages = canvas.doc.getPages();
  pages.forEach((page, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    const width = canvas.font.widthOfTextAtSize(label, 7);
    page.drawText(label, { x: PAGE_W - MARGIN - width, y: MARGIN - 20, size: 7, font: canvas.font, color: MUTED });
  });

  return canvas.doc.save();
}
