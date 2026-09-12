import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

/**
 * Marks a Draft quote as Sent. Quotes go out as a PDF (see the pdf route) —
 * there is no public approval link to mint. The operator records the
 * customer's decision manually once they reply.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;
  try {
    const { id } = await params;
    const existing = await prisma.quote.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }
    if (existing.status !== "Draft") {
      return NextResponse.json({ error: "Only Draft quotes can be sent" }, { status: 400 });
    }

    const quote = await prisma.quote.update({
      where: { id },
      data: {
        status: "Sent",
        sentAt: new Date(),
      },
      include: { lineItems: true, client: true },
    });

    await audit(user!.userId, "UPDATE", "Quote", quote.id, {
      status: "Sent",
      quoteNumber: quote.quoteNumber,
    });

    return NextResponse.json({ quote });
  } catch (error) {
    console.error("Send Quote API Error:", error);
    return NextResponse.json({ error: "Failed to send quote" }, { status: 500 });
  }
}
