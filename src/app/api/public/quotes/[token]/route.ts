import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { QuoteStatus, canRespondToQuote, computeQuoteTotal, deriveQuoteStatus } from "@/lib/quote";
import { dateToLocalStr } from "@/lib/dateUtils";
import { readCompanyDetails } from "@/lib/pdfDoc";

// ---------------------------------------------------------------------------
// THE ONLY UNAUTHENTICATED DATA ROUTE IN THE APP.
//
// A customer reaches it with nothing but the 256-bit token from their quote
// link — no session, no account. Three rules follow from that and must hold for
// any future edit:
//
//   1. The token is the entire credential, so treat it like a password: never
//      log it, never echo it back, and never let a wrong one reveal whether a
//      quote exists (every failure is the same 404).
//   2. Only the whitelist in `publicQuoteView` may leave this file. The Quote
//      row also carries the internal id, jobId and token; the Client row carries
//      the whole customer record. None of it is the recipient's business.
//   3. Everything is rate limited. Without a session there is no other brake on
//      someone walking the token space or spamming responses.
// ---------------------------------------------------------------------------

const WINDOW_MS = 5 * 60 * 1000;
/** Reads are cheap; a customer refreshing their own quote must not get locked out. */
const READ_MAX_PER_IP = 60;
/** Writes are a one-shot decision. Anything beyond a few retries is abuse. */
const WRITE_MAX_PER_IP = 10;
const WRITE_MAX_PER_TOKEN = 5;

/** 32 random bytes encode to 43 base64url characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,}$/;

const MAX_NAME_LENGTH = 100;
const MIN_NAME_LENGTH = 2;
const MAX_REASON_LENGTH = 500;

/** Uniform "no such quote" reply. Never says whether the token merely expired. */
const notFound = () => NextResponse.json({ error: "Quote not found" }, { status: 404 });

const tooMany = () =>
  NextResponse.json({ error: "Too many requests. Please wait a few minutes and try again." }, { status: 429 });

/**
 * Rate-limit key. Falls back to the token when the client address is unknown —
 * never to a shared constant, which would put every anonymous visitor in one
 * bucket and let a single caller lock out the rest (see getClientIp).
 */
const limitKey = (prefix: string, ip: string | null, token: string) => `${prefix}:${ip ?? `tok:${token}`}`;

type QuoteWithRelations = {
  quoteNumber: string;
  status: string;
  issueDate: Date;
  expiryDate: Date;
  notes: string | null;
  respondedAt: Date | null;
  respondedName: string | null;
  client: { name: string; contactName: string; locationAddress: string; paymentTerms: string };
  lineItems: { description: string; quantity: number; rate: number }[];
};

/** The complete set of fields a customer is allowed to see. Nothing else. */
function publicQuoteView(quote: QuoteWithRelations, settings: { key: string; value: string }[]) {
  const company = readCompanyDetails(settings);
  const effectiveStatus = deriveQuoteStatus(quote.status as QuoteStatus, quote.expiryDate);
  return {
    quoteNumber: quote.quoteNumber,
    status: effectiveStatus,
    issueDate: dateToLocalStr(quote.issueDate.toISOString()),
    expiryDate: dateToLocalStr(quote.expiryDate.toISOString()),
    notes: quote.notes,
    respondedAt: quote.respondedAt ? dateToLocalStr(quote.respondedAt.toISOString()) : null,
    respondedName: quote.respondedName,
    company: { name: company.name, address: company.address, phone: company.phone, email: company.email },
    client: {
      name: quote.client.name,
      contactName: quote.client.contactName,
      locationAddress: quote.client.locationAddress,
      paymentTerms: quote.client.paymentTerms,
    },
    lineItems: quote.lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      rate: li.rate,
      amount: li.quantity * li.rate,
    })),
    total: computeQuoteTotal(quote.lineItems),
    // Tells the page whether to render the accept/decline buttons at all. The
    // POST handler re-checks this; the flag is a UI hint, never the gate.
    canRespond: canRespondToQuote(quote.status as QuoteStatus, quote.expiryDate).ok,
  };
}

const QUOTE_INCLUDE = {
  client: true,
  lineItems: { orderBy: { createdAt: "asc" } },
} as const;

/** Never let a quote sit in a shared or browser cache. */
const NO_STORE = { "Cache-Control": "no-store, private" };

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!TOKEN_PATTERN.test(token)) return notFound();

    const ip = getClientIp(request);
    if (!checkRateLimit(limitKey("quote:read", ip, token), READ_MAX_PER_IP, WINDOW_MS)) {
      return tooMany();
    }

    const quote = await prisma.quote.findUnique({ where: { publicToken: token }, include: QUOTE_INCLUDE });
    if (!quote) return notFound();

    const settings = await prisma.systemSetting.findMany();
    return NextResponse.json(publicQuoteView(quote, settings), { headers: NO_STORE });
  } catch (error) {
    // Logged without the token — it is the credential.
    console.error("Public Quote GET Error:", error);
    return NextResponse.json({ error: "Failed to load quote" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!TOKEN_PATTERN.test(token)) return notFound();

    const ip = getClientIp(request);
    if (
      !checkRateLimit(limitKey("quote:write", ip, token), WRITE_MAX_PER_IP, WINDOW_MS) ||
      !checkRateLimit(`quote:write:tok:${token}`, WRITE_MAX_PER_TOKEN, WINDOW_MS)
    ) {
      return tooMany();
    }

    const body = await request.json().catch(() => null);
    const action = body?.action;
    if (action !== "approve" && action !== "decline") {
      return NextResponse.json({ error: "Choose whether to accept or decline this quote." }, { status: 400 });
    }

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (action === "approve" && (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH)) {
      return NextResponse.json({ error: "Please type your full name to accept this quote." }, { status: 400 });
    }
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, MAX_REASON_LENGTH) : "";

    const quote = await prisma.quote.findUnique({ where: { publicToken: token }, include: QUOTE_INCLUDE });
    if (!quote) return notFound();

    // The authoritative gate. `canRespond` in the GET payload is only a hint;
    // this is what actually decides, so a stale page or a hand-made request
    // cannot accept an expired or already-decided quote.
    const check = canRespondToQuote(quote.status as QuoteStatus, quote.expiryDate);
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 409 });
    }

    const updated = await prisma.quote.update({
      where: { publicToken: token },
      data: {
        status: action === "approve" ? "Approved" : "Declined",
        respondedAt: new Date(),
        respondedName: action === "approve" ? name.slice(0, MAX_NAME_LENGTH) : null,
        declineReason: action === "decline" ? reason || null : null,
      },
      include: QUOTE_INCLUDE,
    });

    // Deliberately no audit() call: AuditLog.userId is a real User relation and
    // there is no user here. The decision, who gave it and when are recorded on
    // the Quote row itself, which is the record that matters.
    const settings = await prisma.systemSetting.findMany();
    return NextResponse.json(publicQuoteView(updated, settings), { headers: NO_STORE });
  } catch (error) {
    console.error("Public Quote POST Error:", error);
    return NextResponse.json({ error: "Failed to record your response" }, { status: 500 });
  }
}
