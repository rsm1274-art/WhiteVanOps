import Stripe from "stripe";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));

// v2.0: there is one product — no Base/Plus tier, so one price.
export function priceId(): string {
  return requireEnv("STRIPE_PRICE_ID");
}
