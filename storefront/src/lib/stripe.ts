import Stripe from "stripe";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));

export type LicenseTier = "base" | "plus";

const PRICE_ID_BY_TIER: Record<LicenseTier, string> = {
  base: requireEnv("STRIPE_PRICE_ID_BASE"),
  plus: requireEnv("STRIPE_PRICE_ID_PLUS"),
};

export function priceIdForTier(tier: LicenseTier): string {
  return PRICE_ID_BY_TIER[tier];
}

export function tierForPriceId(priceId: string): LicenseTier | null {
  const entry = (Object.entries(PRICE_ID_BY_TIER) as [LicenseTier, string][]).find(
    ([, id]) => id === priceId
  );
  return entry ? entry[0] : null;
}

export function isLicenseTier(value: unknown): value is LicenseTier {
  return value === "base" || value === "plus";
}
