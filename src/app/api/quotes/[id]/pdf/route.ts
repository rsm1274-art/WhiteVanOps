import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { QuoteStatus, computeQuoteTotal, deriveQuoteStatus } from "@/lib/quote";
import { dateToLocalStr } from "@/lib/dateUtils";
import { LEFT, MUTED, RIGHT, TOP, createDocCanvas, money, readCompanyDetails, truncate } from "@/lib/pdfDoc";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  try {
    const { id } = await params;
    const [quote, settings] = await Promise.all([
      prisma.quote.findUnique({
        where: { id },
        include: { client: true, lineItems: { orderBy: { createdAt: "asc" } } },
      }),
      prisma.systemSetting.findMany(),
    ]);
    if (!quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    const company = readCompanyDetails(settings);
    const { doc, bold, text, hr } = await createDocCanvas();
    let y = TOP;

    // Header
    text(company.name, LEFT, y, { font: bold, size: 18 });
    text("QUOTE", RIGHT, y, { font: bold, size: 18, alignRight: true });
    y -= 16;
    text(company.address, LEFT, y, { size: 9, color: MUTED });
    text(quote.quoteNumber, RIGHT, y, { size: 11, alignRight: true, color: MUTED });
    if (company.phone || company.email) {
      y -= 12;
      text([company.phone, company.email].filter(Boolean).join("  ·  "), LEFT, y, { size: 8, color: MUTED });
    }
    y -= 24;
    hr(y);
    y -= 24;

    // Quote-for / dates
    const effectiveStatus = deriveQuoteStatus(quote.status as QuoteStatus, quote.expiryDate);
    text("QUOTE FOR", LEFT, y, { font: bold, size: 8, color: MUTED });
    text("ISSUE DATE", 360, y, { font: bold, size: 8, color: MUTED });
    text("VALID UNTIL", 470, y, { font: bold, size: 8, color: MUTED });
    y -= 14;
    text(quote.client.name, LEFT, y, { font: bold, size: 11 });
    text(dateToLocalStr(quote.issueDate.toISOString()), 360, y);
    text(dateToLocalStr(quote.expiryDate.toISOString()), 470, y);
    y -= 13;
    text(quote.client.contactName, LEFT, y, { size: 9, color: MUTED });
    text("STATUS", 360, y - 6, { font: bold, size: 8, color: MUTED });
    y -= 13;
    text(quote.client.locationAddress, LEFT, y, { size: 9, color: MUTED });
    text(effectiveStatus, 360, y - 1, { font: bold, size: 10 });
    y -= 36;

    // Line items
    hr(y + 12);
    text("DESCRIPTION", LEFT, y, { font: bold, size: 8, color: MUTED });
    text("QTY", 400, y, { font: bold, size: 8, color: MUTED, alignRight: true });
    text("RATE", 470, y, { font: bold, size: 8, color: MUTED, alignRight: true });
    text("AMOUNT", RIGHT, y, { font: bold, size: 8, color: MUTED, alignRight: true });
    y -= 8;
    hr(y);
    y -= 18;

    for (const li of quote.lineItems) {
      text(truncate(li.description, 62), LEFT, y);
      text(String(li.quantity), 400, y, { alignRight: true });
      text(money(li.rate), 470, y, { alignRight: true });
      text(money(li.quantity * li.rate), RIGHT, y, { alignRight: true });
      y -= 18;
    }

    y -= 4;
    hr(y + 12);

    // Total. A quote has no payments, so this is the whole money story.
    text("TOTAL", 470, y - 6, { font: bold, size: 10, alignRight: true });
    text(money(computeQuoteTotal(quote.lineItems)), RIGHT, y - 6, { font: bold, size: 10, alignRight: true });
    y -= 30;

    if (quote.notes) {
      text("NOTES", LEFT, y, { font: bold, size: 8, color: MUTED });
      y -= 13;
      text(truncate(quote.notes, 100), LEFT, y, { size: 9 });
      y -= 24;
    }

    // The validity line is the one thing a quote must say that an invoice never
    // does: this price is an offer, and it has an end date.
    text(
      `This quote is valid until ${dateToLocalStr(quote.expiryDate.toISOString())}. Prices may change after that date.`,
      LEFT,
      y,
      { size: 9, color: MUTED }
    );
    y -= 16;
    text(`Payment terms on acceptance: ${quote.client.paymentTerms}`, LEFT, y, { size: 9, color: MUTED });

    const bytes = await doc.save();

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${quote.quoteNumber}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Quote PDF API Error:", error);
    return NextResponse.json({ error: "Failed to generate PDF" }, { status: 500 });
  }
}
