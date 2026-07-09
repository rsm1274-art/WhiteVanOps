import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hasPlusLicense, requirePlus } from "@/lib/license";
import { formatInvoiceNumber, INVOICE_NUMBER_SETTING_KEY } from "@/lib/invoice";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const licErr = requirePlus(await hasPlusLicense());
  if (licErr) return licErr;

  try {
    const { clientId, jobId, issueDate, dueDate, notes, lineItems } = await request.json();

    if (!clientId || !issueDate || !dueDate) {
      return NextResponse.json({ error: "Client, issue date, and due date are required" }, { status: 400 });
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

    // Invoice number comes from a SystemSetting counter incremented in the
    // same transaction as the create — sufficient for single-tenant,
    // low-concurrency usage.
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

      return tx.invoice.create({
        data: {
          invoiceNumber: formatInvoiceNumber(next),
          clientId,
          jobId: jobId || null,
          issueDate: new Date(issueDate),
          dueDate: new Date(dueDate),
          notes: notes?.trim() || null,
          lineItems: {
            create: lineItems.map((li: { description: string; quantity: number; rate: number }) => ({
              description: li.description.trim(),
              quantity: Number(li.quantity),
              rate: Number(li.rate),
            })),
          },
        },
        include: { lineItems: true, payments: true, client: true },
      });
    });

    await audit(user!.userId, "CREATE", "Invoice", invoice.id, {
      invoiceNumber: invoice.invoiceNumber,
      clientId,
    });

    return NextResponse.json(invoice);
  } catch (error) {
    console.error("Create Invoice API Error:", error);
    return NextResponse.json({ error: "Failed to create invoice" }, { status: 500 });
  }
}
