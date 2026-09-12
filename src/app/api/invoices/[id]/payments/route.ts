import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import {
  computeInvoiceTotal,
  computePaidTotal,
  deriveInvoiceStatus,
  InvoiceStatus,
} from "@/lib/invoice";
import { parseLocalDate } from "@/lib/dateUtils";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  try {
    const { id: invoiceId } = await params;
    const { amount, method, reference, receivedDate } = await request.json();

    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ error: "Payment amount must be positive" }, { status: 400 });
    }
    if (!method || !receivedDate) {
      return NextResponse.json({ error: "Method and received date are required" }, { status: 400 });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true, payments: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (invoice.status === "Void") {
      return NextResponse.json({ error: "Cannot record a payment on a voided invoice" }, { status: 400 });
    }
    if (invoice.status === "Draft") {
      return NextResponse.json({ error: "Mark the invoice as Sent before recording payments" }, { status: 400 });
    }

    const total = computeInvoiceTotal(invoice.lineItems);
    const alreadyPaid = computePaidTotal(invoice.payments);
    if (alreadyPaid + parsedAmount > total + 0.005) {
      return NextResponse.json(
        { error: `Payment exceeds the outstanding balance ($${(total - alreadyPaid).toFixed(2)})` },
        { status: 400 }
      );
    }

    const newStatus = deriveInvoiceStatus(
      invoice.status as InvoiceStatus,
      total,
      alreadyPaid + parsedAmount
    );

    // A Paid invoice with a linked job means that job's billing is settled,
    // so it can drop off the QuickBooks "Pending Invoice Lines" export list.
    // The two systems are otherwise independent (see the schema comment on
    // Invoice) — this is the one point where a fully-paid invoice reflects
    // back onto the job it billed.
    const jobSyncUpdate =
      newStatus === "Paid" && invoice.jobId
        ? [prisma.job.update({ where: { id: invoice.jobId }, data: { qbInvoiceSyncStatus: "Exported" } })]
        : [];

    const [payment] = await prisma.$transaction([
      prisma.payment.create({
        data: {
          invoiceId,
          amount: parsedAmount,
          method,
          reference: reference?.trim() || null,
          receivedDate: parseLocalDate(`${receivedDate}T12:00:00`),
          recordedById: user!.userId,
        },
      }),
      prisma.invoice.update({ where: { id: invoiceId }, data: { status: newStatus } }),
      ...jobSyncUpdate,
    ]);

    await audit(user!.userId, "CREATE", "Payment", payment.id, {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      amount: parsedAmount,
    });
    if (jobSyncUpdate.length > 0) {
      await audit(user!.userId, "UPDATE", "Job", invoice.jobId!, { qbInvoiceSyncStatus: "Exported" });
    }

    return NextResponse.json({ payment, status: newStatus });
  } catch (error) {
    console.error("Record Payment API Error:", error);
    return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
  }
}
