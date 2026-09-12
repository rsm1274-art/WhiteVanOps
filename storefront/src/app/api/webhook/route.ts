import { NextRequest, NextResponse } from "next/server";
import { claimStripeSession, mintLicenseForPurchase, recordStripeSessionResult } from "@/lib/licenses";
import { downloadUrl } from "@/lib/releases";
import { sendLicenseEmail } from "@/lib/resend";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

const HANDLED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature ?? "", requireEnv("STRIPE_WEBHOOK_SECRET"));
  } catch (error) {
    console.error("Stripe webhook signature verification failed", error);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    // Ack anything we don't act on — Stripe retries non-2xx responses.
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  const claimed = await claimStripeSession(session.id);
  if (!claimed) {
    // Already processed this session on a prior delivery attempt.
    return NextResponse.json({ received: true, duplicate: true });
  }

  const { key } = await mintLicenseForPurchase({
    notes: `Stripe checkout session ${session.id}`,
  });

  const customerEmail = session.customer_details?.email ?? null;
  let emailedAt: string | null = null;

  if (customerEmail) {
    try {
      await sendLicenseEmail({
        to: customerEmail,
        licenseKey: key,
        downloadUrl: downloadUrl(),
      });
      emailedAt = new Date().toISOString();
    } catch (error) {
      // The license is already minted (the durable side effect) — an email
      // failure here must not turn into a Stripe retry, which would mint a
      // second key. Log for a manual resend instead.
      console.error(`Failed to email license ${key} for session ${session.id}`, error);
    }
  } else {
    console.error(`Stripe session ${session.id} has no customer email — license ${key} needs manual delivery`);
  }

  await recordStripeSessionResult(session.id, { licenseKey: key, emailedAt });

  return NextResponse.json({ received: true });
}
