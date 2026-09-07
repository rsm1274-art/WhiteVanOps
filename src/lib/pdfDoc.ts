// Shared pdf-lib scaffolding for the documents this app hands to customers
// (invoices and quotes). Layout stays in each route — this module only owns the
// page setup, the palette, and the two drawing primitives both documents use,
// so the pair can't drift on typography or margins.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

/** US Letter, in points. */
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
export const MARGIN = 54;
export const LEFT = MARGIN;
export const RIGHT = PAGE_WIDTH - MARGIN;
/** Baseline of the first line of the header block. */
export const TOP = 738;

export const ZINC = rgb(0.25, 0.25, 0.27);
export const MUTED = rgb(0.55, 0.55, 0.58);
export const LINE = rgb(0.85, 0.85, 0.87);

export interface TextOptions {
  size?: number;
  font?: PDFFont;
  color?: ReturnType<typeof rgb>;
  /** Treat `x` as the right edge and lay the string out leftwards from it. */
  alignRight?: boolean;
}

export interface DocCanvas {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  /** Draws a string at a baseline, optionally right-aligned to `x`. */
  text: (str: string, x: number, y: number, opts?: TextOptions) => void;
  /** Draws a full-width horizontal rule at `y`. */
  hr: (y: number) => void;
}

/** Creates a one-page Letter document with the shared fonts and helpers bound. */
export async function createDocCanvas(): Promise<DocCanvas> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const text = (str: string, x: number, y: number, opts: TextOptions = {}) => {
    const f = opts.font ?? font;
    const size = opts.size ?? 10;
    const drawX = opts.alignRight ? x - f.widthOfTextAtSize(str, size) : x;
    page.drawText(str, { x: drawX, y, size, font: f, color: opts.color ?? ZINC });
  };

  const hr = (y: number) =>
    page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 1, color: LINE });

  return { doc, page, font, bold, text, hr };
}

/** Money as it appears on every customer-facing document. */
export const money = (n: number) => `$${n.toFixed(2)}`;

/** Single-line truncation, so a long free-text field can't run off the page. */
export function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

export interface CompanyDetails {
  name: string;
  address: string;
  phone: string;
  email: string;
  remittance: string;
}

/** Pulls the company block out of SystemSetting rows, with the shipped defaults. */
export function readCompanyDetails(settings: { key: string; value: string }[]): CompanyDetails {
  const get = (key: string) => settings.find((s) => s.key === key)?.value || "";
  return {
    name: get("company_name") || "WHITE VAN OPS",
    address: get("company_address") || "Field Service Operations",
    phone: get("company_phone"),
    email: get("company_email"),
    remittance: get("company_remittance"),
  };
}
