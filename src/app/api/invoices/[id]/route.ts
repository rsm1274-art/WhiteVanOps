import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hasPlusLicense, requirePlus } from "@/lib/license";
import { InvoiceStatus } from "@/lib/invoice";
import { parseLocalDate } from "@/lib/dateUtils";

// Manual status moves only: Draft→Sent (mark sent) and →Void. Paid /
// PartiallyPaid are derived from recorded payments, never set by hand.
const MANUAL_STATUSES: InvoiceStatus[] = ["Sent", "Void"];

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const licErr = requirePlus(await hasPlusLicense());
  if (licErr) return licErr;

  try {
    const { id } = await params;
    const { status, notes, dueDate } = await request.json();

    const existing = await prisma.invoice.findUnique({ where: { id }, include: { payments: true } });
    if (!existing) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if (status !== undefined) {
      if (!MANUAL_STATUSES.includes(status)) {
        return NextResponse.json({ error: "Status can only be set to Sent or Void" }, { status: 400 });
      }
      if (status === "Sent" && existing.status !== "Draft") {
        return NextResponse.json({ error: "Only Draft invoices can be marked Sent" }, { status: 400 });
      }
      if (status === "Void" && existing.payments.length > 0) {
        return NextResponse.json({ error: "Cannot void an invoice with recorded payments" }, { status: 400 });
      }
    }

    const invoice = await prisma.invoice.update({
      where: { id },
      data: {
        ...(status !== undefined && { status }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
        ...(dueDate !== undefined && { dueDate: parseLocalDate(`${dueDate}T12:00:00`) }),
      },
      include: { lineItems: true, payments: true, client: true },
    });

    await audit(user!.userId, "UPDATE", "Invoice", invoice.id, { status });

    return NextResponse.json(invoice);
  } catch (error) {
    console.error("Update Invoice API Error:", error);
    return NextResponse.json({ error: "Failed to update invoice" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  const licErr = requirePlus(await hasPlusLicense());
  if (licErr) return licErr;

  try {
    const { id } = await params;
    const existing = await prisma.invoice.findUnique({ where: { id }, include: { payments: true } });
    if (!existing) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    // Only unsent drafts can be deleted — issued invoices are financial
    // records and must be voided instead.
    if (existing.status !== "Draft" || existing.payments.length > 0) {
      return NextResponse.json({ error: "Only Draft invoices without payments can be deleted" }, { status: 400 });
    }

    await prisma.invoice.delete({ where: { id } });
    await audit(user!.userId, "DELETE", "Invoice", id, { invoiceNumber: existing.invoiceNumber });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete Invoice API Error:", error);
    return NextResponse.json({ error: "Failed to delete invoice" }, { status: 500 });
  }
}
