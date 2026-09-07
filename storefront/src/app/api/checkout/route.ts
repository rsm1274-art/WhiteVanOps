import { NextRequest, NextResponse } from "next/server";
import { isLicenseTier, priceIdForTier, stripe } from "@/lib/stripe";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": requireEnv("MARKETING_SITE_ORIGIN"),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers });
  }

  const tier = (body as { tier?: unknown })?.tier;
  if (!isLicenseTier(tier)) {
    return NextResponse.json(
      { error: "tier must be 'base' or 'plus'" },
      { status: 400, headers }
    );
  }

  const siteUrl = requireEnv("NEXT_PUBLIC_SITE_URL");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceIdForTier(tier), quantity: 1 }],
    success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/cancel`,
    metadata: { tier },
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe did not return a checkout URL" },
      { status: 502, headers }
    );
  }

  return NextResponse.json({ url: session.url }, { headers });
}
