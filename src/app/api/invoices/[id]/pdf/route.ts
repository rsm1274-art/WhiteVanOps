import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { computeInvoiceTotal, computePaidTotal } from "@/lib/invoice";
import { dateToLocalStr } from "@/lib/dateUtils";
import { LEFT, MUTED, RIGHT, TOP, createDocCanvas, money, readCompanyDetails, truncate } from "@/lib/pdfDoc";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
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

    const company = readCompanyDetails(settings);
    const { doc, bold, text, hr } = await createDocCanvas();
    let y = TOP;

    // Header
    text(company.name, LEFT, y, { font: bold, size: 18 });
    text("INVOICE", RIGHT, y, { font: bold, size: 18, alignRight: true });
    y -= 16;
    text(company.address, LEFT, y, { size: 9, color: MUTED });
    text(invoice.invoiceNumber, RIGHT, y, { size: 11, alignRight: true, color: MUTED });
    if (company.phone || company.email) {
      y -= 12;
      const contactInfo = [company.phone, company.email].filter(Boolean).join("  ·  ");
      text(contactInfo, LEFT, y, { size: 8, color: MUTED });
    }
    y -= 24;
    hr(y);
    y -= 24;

    // Bill-to / dates
    text("BILL TO", LEFT, y, { font: bold, size: 8, color: MUTED });
    text("ISSUE DATE", 360, y, { font: bold, size: 8, color: MUTED });
    text("DUE DATE", 470, y, { font: bold, size: 8, color: MUTED });
    y -= 14;
    text(invoice.client.name, LEFT, y, { font: bold, size: 11 });
    text(dateToLocalStr(invoice.issueDate.toISOString()), 360, y);
    text(dateToLocalStr(invoice.dueDate.toISOString()), 470, y);
    y -= 13;
    text(invoice.client.contactName, LEFT, y, { size: 9, color: MUTED });
    text("STATUS", 360, y - 6, { font: bold, size: 8, color: MUTED });
    y -= 13;
    text(invoice.client.locationAddress, LEFT, y, { size: 9, color: MUTED });
    text(invoice.status === "PartiallyPaid" ? "Partially Paid" : invoice.status, 360, y - 1, { font: bold, size: 10 });
    y -= 36;

    // Line items table
    hr(y + 12);
    text("DESCRIPTION", LEFT, y, { font: bold, size: 8, color: MUTED });
    text("QTY", 400, y, { font: bold, size: 8, color: MUTED, alignRight: true });
    text("RATE", 470, y, { font: bold, size: 8, color: MUTED, alignRight: true });
    text("AMOUNT", RIGHT, y, { font: bold, size: 8, color: MUTED, alignRight: true });
    y -= 8;
    hr(y);
    y -= 18;

    for (const li of invoice.lineItems) {
      text(truncate(li.description, 62), LEFT, y);
      text(String(li.quantity), 400, y, { alignRight: true });
      text(money(li.rate), 470, y, { alignRight: true });
      text(money(li.quantity * li.rate), RIGHT, y, { alignRight: true });
      y -= 18;
    }

    y -= 4;
    hr(y + 12);

    // Totals
    const total = computeInvoiceTotal(invoice.lineItems);
    const paid = computePaidTotal(invoice.payments);
    text("TOTAL", 470, y - 6, { font: bold, size: 10, alignRight: true });
    text(money(total), RIGHT, y - 6, { font: bold, size: 10, alignRight: true });
    y -= 24;
    if (paid > 0) {
      text("PAID", 470, y, { size: 9, color: MUTED, alignRight: true });
      text(`-${money(paid)}`, RIGHT, y, { size: 9, color: MUTED, alignRight: true });
      y -= 16;
      text("BALANCE DUE", 470, y, { font: bold, size: 10, alignRight: true });
      text(money(total - paid), RIGHT, y, { font: bold, size: 10, alignRight: true });
      y -= 16;
    }

    // Notes + payment terms
    y -= 24;
    if (invoice.notes) {
      text("NOTES", LEFT, y, { font: bold, size: 8, color: MUTED });
      y -= 13;
      text(truncate(invoice.notes, 100), LEFT, y, { size: 9 });
      y -= 24;
    }
    text(`Payment terms: ${invoice.client.paymentTerms}`, LEFT, y, { size: 9, color: MUTED });

    if (company.remittance) {
      y -= 20;
      text("REMITTANCE INSTRUCTIONS", LEFT, y, { font: bold, size: 8, color: MUTED });
      y -= 12;
      const lines = company.remittance.split("\n");
      for (const lineStr of lines) {
        text(truncate(lineStr, 90), LEFT, y, { size: 8 });
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
