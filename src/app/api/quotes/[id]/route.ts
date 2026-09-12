import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { QuoteStatus, canDeleteQuote, canRespondToQuote } from "@/lib/quote";
import { parseLocalDate } from "@/lib/dateUtils";

// Statuses an operator may set by hand here: recording a decision the customer
// gave over the phone or by email. "Sent" is deliberately absent — it belongs to
// POST /api/quotes/[id]/send, which also mints the public approval token, so the
// two can never fall out of step. "Converted" is set only by the convert route,
// and "Expired" is derived from the clock, never stored by hand.
const MANUAL_STATUSES: QuoteStatus[] = ["Approved", "Declined"];

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  try {
    const { id } = await params;
    const { status, notes, expiryDate, respondedName, declineReason } = await request.json();

    const existing = await prisma.quote.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    if (status !== undefined) {
      if (!MANUAL_STATUSES.includes(status)) {
        return NextResponse.json({ error: "Status can only be set to Approved or Declined" }, { status: 400 });
      }
      // Same gate the customer's own public response goes through, so a decision
      // recorded by hand obeys the identical expiry and already-decided rules.
      const check = canRespondToQuote(existing.status as QuoteStatus, existing.expiryDate);
      if (!check.ok) {
        return NextResponse.json({ error: check.reason }, { status: 400 });
      }
    }

    // The expiry date is the one field still worth changing after issue — an
    // operator extending a quote the customer is still thinking about.
    if (expiryDate !== undefined && existing.status === "Converted") {
      return NextResponse.json({ error: "A converted quote can no longer be changed" }, { status: 400 });
    }

    const quote = await prisma.quote.update({
      where: { id },
      data: {
        ...(status !== undefined && {
          status,
          respondedAt: new Date(),
          respondedName: status === "Approved" ? respondedName?.trim() || "Recorded by office" : null,
          declineReason: status === "Declined" ? declineReason?.trim() || null : null,
        }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
        ...(expiryDate !== undefined && { expiryDate: parseLocalDate(`${expiryDate}T12:00:00`) }),
      },
      include: { lineItems: true, client: true },
    });

    await audit(user!.userId, "UPDATE", "Quote", quote.id, { status });

    return NextResponse.json(quote);
  } catch (error) {
    console.error("Update Quote API Error:", error);
    return NextResponse.json({ error: "Failed to update quote" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  try {
    const { id } = await params;
    const existing = await prisma.quote.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }
    // Once a quote has gone out to a customer it is a record of what was
    // offered, so it can only be declined or left to expire, never deleted.
    if (!canDeleteQuote(existing.status as QuoteStatus)) {
      return NextResponse.json({ error: "Only Draft quotes can be deleted" }, { status: 400 });
    }

    await prisma.quote.delete({ where: { id } });
    await audit(user!.userId, "DELETE", "Quote", id, { quoteNumber: existing.quoteNumber });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete Quote API Error:", error);
    return NextResponse.json({ error: "Failed to delete quote" }, { status: 500 });
  }
}
