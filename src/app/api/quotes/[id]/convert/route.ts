import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { QuoteStatus, canConvertQuote } from "@/lib/quote";
import { formatInvoiceNumber, INVOICE_NUMBER_SETTING_KEY } from "@/lib/invoice";
import { parseLocalDate } from "@/lib/dateUtils";

const DEFAULT_PAYMENT_DAYS = 30;

/**
 * Turns an approved quote into a Draft invoice, copying the line items across
 * unchanged so the customer is billed exactly what they accepted.
 *
 * Both writes happen in one transaction, and Quote.convertedInvoiceId is unique,
 * so a double-click cannot produce two invoices for one quote.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { issueDate, dueDate } = body as { issueDate?: string; dueDate?: string };

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: { lineItems: { orderBy: { createdAt: "asc" } } },
    });
    if (!quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }
    if (!canConvertQuote(quote.status as QuoteStatus)) {
      return NextResponse.json(
        { error: "Only an approved quote can be converted to an invoice" },
        { status: 400 }
      );
    }

    const issue = issueDate ? parseLocalDate(`${issueDate}T12:00:00`) : new Date();
    const due = dueDate
      ? parseLocalDate(`${dueDate}T12:00:00`)
      : new Date(issue.getTime() + DEFAULT_PAYMENT_DAYS * 24 * 60 * 60 * 1000);
    if (due < issue) {
      return NextResponse.json({ error: "Due date cannot be before the issue date" }, { status: 400 });
    }

    const invoice = await prisma.$transaction(async (tx) => {
      const counter = await tx.systemSetting.upsert({
        where: { key: INVOICE_NUMBER_SETTING_KEY },
        update: {},
        create: { key: INVOICE_NUMBER_SETTING_KEY, value: "1" },
      });
      const next = parseInt(counter.value, 10) || 1;
      await tx.systemSetting.update({
        where: { key: INVOICE_NUMBER_SETTING_KEY },
        data: { value: String(next + 1) },
      });

      const created = await tx.invoice.create({
        data: {
          invoiceNumber: formatInvoiceNumber(next),
          clientId: quote.clientId,
          jobId: quote.jobId,
          issueDate: issue,
          dueDate: due,
          notes: quote.notes,
          lineItems: {
            create: quote.lineItems.map((li) => ({
              description: li.description,
              quantity: li.quantity,
              rate: li.rate,
            })),
          },
        },
        include: { lineItems: true, payments: true, client: true },
      });

      await tx.quote.update({
        where: { id },
        data: { status: "Converted", convertedInvoiceId: created.id },
      });

      return created;
    });

    await audit(user!.userId, "CREATE", "Invoice", invoice.id, {
      invoiceNumber: invoice.invoiceNumber,
      fromQuote: quote.quoteNumber,
    });
    await audit(user!.userId, "UPDATE", "Quote", quote.id, {
      status: "Converted",
      invoiceNumber: invoice.invoiceNumber,
    });

    return NextResponse.json({ invoice });
  } catch (error) {
    console.error("Convert Quote API Error:", error);
    return NextResponse.json({ error: "Failed to convert quote" }, { status: 500 });
  }
}
