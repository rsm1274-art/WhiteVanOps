import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { formatQuoteNumber, QUOTE_NUMBER_SETTING_KEY } from "@/lib/quote";
import { parseLocalDate } from "@/lib/dateUtils";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  try {
    const { clientId, jobId, issueDate, expiryDate, notes, lineItems } = await request.json();

    if (!clientId || !issueDate || !expiryDate) {
      return NextResponse.json({ error: "Client, issue date, and expiry date are required" }, { status: 400 });
    }
    if (parseLocalDate(`${expiryDate}T12:00:00`) < parseLocalDate(`${issueDate}T12:00:00`)) {
      return NextResponse.json({ error: "Expiry date cannot be before the issue date" }, { status: 400 });
    }
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
    }
    for (const li of lineItems) {
      const qty = Number(li.quantity);
      const rate = Number(li.rate);
      if (!li.description?.trim() || isNaN(qty) || qty <= 0 || isNaN(rate) || rate < 0) {
        return NextResponse.json(
          { error: "Each line item needs a description, a positive quantity, and a non-negative rate" },
          { status: 400 }
        );
      }
    }
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Quote number comes from its own SystemSetting counter, incremented in the
    // same transaction as the create — same approach as invoice numbering.
    const quote = await prisma.$transaction(async (tx) => {
      const counter = await tx.systemSetting.upsert({
        where: { key: QUOTE_NUMBER_SETTING_KEY },
        update: {},
        create: { key: QUOTE_NUMBER_SETTING_KEY, value: "1" },
      });
      const next = parseInt(counter.value, 10) || 1;
      await tx.systemSetting.update({
        where: { key: QUOTE_NUMBER_SETTING_KEY },
        data: { value: String(next + 1) },
      });

      return tx.quote.create({
        data: {
          quoteNumber: formatQuoteNumber(next),
          clientId,
          jobId: jobId || null,
          issueDate: parseLocalDate(`${issueDate}T12:00:00`),
          expiryDate: parseLocalDate(`${expiryDate}T12:00:00`),
          notes: notes?.trim() || null,
          lineItems: {
            create: lineItems.map((li: { description: string; quantity: number; rate: number }) => ({
              description: li.description.trim(),
              quantity: Number(li.quantity),
              rate: Number(li.rate),
            })),
          },
        },
        include: { lineItems: true, client: true },
      });
    });

    await audit(user!.userId, "CREATE", "Quote", quote.id, {
      quoteNumber: quote.quoteNumber,
      clientId,
    });

    return NextResponse.json(quote);
  } catch (error) {
    console.error("Create Quote API Error:", error);
    return NextResponse.json({ error: "Failed to create quote" }, { status: 500 });
  }
}
