import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildQuoteApprovalUrl } from "@/lib/quote";
import { generateQuoteToken } from "@/lib/quoteToken";

const FIELD_ACCESS_SETTING_KEY = "field_access_url";

/**
 * Marks a Draft quote as Sent and mints its public approval token.
 *
 * Minting here rather than at create time means a quote that never leaves the
 * office never has a live public link at all — the unauthenticated surface only
 * exists for quotes deliberately issued to a customer.
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
        // Re-sending is not possible (Draft-only), so this token is written once
        // and stays valid for the life of the quote.
        publicToken: generateQuoteToken(),
      },
      include: { lineItems: true, client: true },
    });

    const fieldAccess = await prisma.systemSetting.findUnique({ where: { key: FIELD_ACCESS_SETTING_KEY } });
    const approvalUrl = buildQuoteApprovalUrl(fieldAccess?.value, new URL(request.url).origin, quote.publicToken!);

    // The token is the secret in that URL, so it is never written to the audit
    // log — only the fact that the quote was issued.
    await audit(user!.userId, "UPDATE", "Quote", quote.id, {
      status: "Sent",
      quoteNumber: quote.quoteNumber,
    });

    return NextResponse.json({ quote, approvalUrl });
  } catch (error) {
    console.error("Send Quote API Error:", error);
    return NextResponse.json({ error: "Failed to send quote" }, { status: 500 });
  }
}
