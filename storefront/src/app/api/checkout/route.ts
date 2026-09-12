import { NextResponse } from "next/server";
import { priceId, stripe } from "@/lib/stripe";

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

export async function POST() {
  const headers = corsHeaders();

  const siteUrl = requireEnv("NEXT_PUBLIC_SITE_URL");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId(), quantity: 1 }],
    success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/cancel`,
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe did not return a checkout URL" },
      { status: 502, headers }
    );
  }

  return NextResponse.json({ url: session.url }, { headers });
}
