import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { hasPlusLicense, requirePlus } from "@/lib/license";
import { computeInvoiceTotal, computePaidTotal } from "@/lib/invoice";
import { dateToLocalStr } from "@/lib/dateUtils";

const money = (n: number) => `$${n.toFixed(2)}`;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const licErr = requirePlus(await hasPlusLicense());
  if (licErr) return licErr;

  try {
    const { id } = await params;
    const [invoice, settings] = await Promise.all([
      prisma.invoice.findUnique({
        where: { id },
        include: { client: true, lineItems: { orderBy: { createdAt: "asc" } }, payments: true },
      }),
      prisma.systemSetting.findMany(),
    ]);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const companyName = settings.find((s) => s.key === "company_name")?.value || "WHITE VAN OPS";
    const companyAddress = settings.find((s) => s.key === "company_address")?.value || "Field Service Operations";
    const companyPhone = settings.find((s) => s.key === "company_phone")?.value || "";
    const companyEmail = settings.find((s) => s.key === "company_email")?.value || "";
    const remittanceInstructions = settings.find((s) => s.key === "company_remittance")?.value || "";

    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]); // US Letter
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const zinc = rgb(0.25, 0.25, 0.27);
    const muted = rgb(0.55, 0.55, 0.58);
    const line = rgb(0.85, 0.85, 0.87);

    const left = 54;
    const right = 612 - 54;
    let y = 738;

    const text = (
      str: string,
      x: number,
      yPos: number,
      opts: { size?: number; font?: typeof font; color?: ReturnType<typeof rgb>; alignRight?: boolean } = {}
    ) => {
      const f = opts.font ?? font;
      const size = opts.size ?? 10;
      const drawX = opts.alignRight ? x - f.widthOfTextAtSize(str, size) : x;
      page.drawText(str, { x: drawX, y: yPos, size, font: f, color: opts.color ?? zinc });
    };
    const hr = (yPos: number) =>
      page.drawLine({ start: { x: left, y: yPos }, end: { x: right, y: yPos }, thickness: 1, color: line });

    // Header
    text(companyName, left, y, { font: bold, size: 18 });
    text("INVOICE", right, y, { font: bold, size: 18, alignRight: true });
    y -= 16;
    text(companyAddress, left, y, { size: 9, color: muted });
    text(invoice.invoiceNumber, right, y, { size: 11, alignRight: true, color: muted });
    if (companyPhone || companyEmail) {
      y -= 12;
      const contactInfo = [companyPhone, companyEmail].filter(Boolean).join("  ·  ");
      text(contactInfo, left, y, { size: 8, color: muted });
    }
    y -= 24;
    hr(y);
    y -= 24;

    // Bill-to / dates
    text("BILL TO", left, y, { font: bold, size: 8, color: muted });
    text("ISSUE DATE", 360, y, { font: bold, size: 8, color: muted });
    text("DUE DATE", 470, y, { font: bold, size: 8, color: muted });
    y -= 14;
    text(invoice.client.name, left, y, { font: bold, size: 11 });
    text(dateToLocalStr(invoice.issueDate.toISOString()), 360, y);
    text(dateToLocalStr(invoice.dueDate.toISOString()), 470, y);
    y -= 13;
    text(invoice.client.contactName, left, y, { size: 9, color: muted });
    text("STATUS", 360, y - 6, { font: bold, size: 8, color: muted });
    y -= 13;
    text(invoice.client.locationAddress, left, y, { size: 9, color: muted });
    text(invoice.status === "PartiallyPaid" ? "Partially Paid" : invoice.status, 360, y - 1, { font: bold, size: 10 });
    y -= 36;

    // Line items table
    hr(y + 12);
    text("DESCRIPTION", left, y, { font: bold, size: 8, color: muted });
    text("QTY", 400, y, { font: bold, size: 8, color: muted, alignRight: true });
    text("RATE", 470, y, { font: bold, size: 8, color: muted, alignRight: true });
    text("AMOUNT", right, y, { font: bold, size: 8, color: muted, alignRight: true });
    y -= 8;
    hr(y);
    y -= 18;

    for (const li of invoice.lineItems) {
      const desc = li.description.length > 62 ? li.description.slice(0, 59) + "..." : li.description;
      text(desc, left, y);
      text(String(li.quantity), 400, y, { alignRight: true });
      text(money(li.rate), 470, y, { alignRight: true });
      text(money(li.quantity * li.rate), right, y, { alignRight: true });
      y -= 18;
    }

    y -= 4;
    hr(y + 12);

    // Totals
    const total = computeInvoiceTotal(invoice.lineItems);
    const paid = computePaidTotal(invoice.payments);
    text("TOTAL", 470, y - 6, { font: bold, size: 10, alignRight: true });
    text(money(total), right, y - 6, { font: bold, size: 10, alignRight: true });
    y -= 24;
    if (paid > 0) {
      text("PAID", 470, y, { size: 9, color: muted, alignRight: true });
      text(`-${money(paid)}`, right, y, { size: 9, color: muted, alignRight: true });
      y -= 16;
      text("BALANCE DUE", 470, y, { font: bold, size: 10, alignRight: true });
      text(money(total - paid), right, y, { font: bold, size: 10, alignRight: true });
      y -= 16;
    }

    // Notes + payment terms
    y -= 24;
    if (invoice.notes) {
      text("NOTES", left, y, { font: bold, size: 8, color: muted });
      y -= 13;
      text(invoice.notes.length > 100 ? invoice.notes.slice(0, 97) + "..." : invoice.notes, left, y, { size: 9 });
      y -= 24;
    }
    text(`Payment terms: ${invoice.client.paymentTerms}`, left, y, { size: 9, color: muted });

    if (remittanceInstructions) {
      y -= 20;
      text("REMITTANCE INSTRUCTIONS", left, y, { font: bold, size: 8, color: muted });
      y -= 12;
      const lines = remittanceInstructions.split("\n");
      for (const lineStr of lines) {
        text(lineStr.length > 90 ? lineStr.slice(0, 87) + "..." : lineStr, left, y, { size: 8 });
        y -= 11;
      }
    }

    const bytes = await doc.save();

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoice.invoiceNumber}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Invoice PDF API Error:", error);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
