import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain CommonJS module shared with scripts/license-manager.js
const { mintLicense } = require("../../../shared/license-mint");
import type { LicenseTier } from "./stripe";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

// Vercel's serverless filesystem has no persistent path to point a service
// account *file* at (unlike scripts/license-manager.js's WVO_FIREBASE_SERVICE_ACCOUNT
// file-path pattern) — so here the service account's JSON contents travel as
// the env var value itself, parsed at cold-start. Same underlying Firebase
// project/credential either way.
function getDb() {
  if (getApps().length === 0) {
    const serviceAccount = JSON.parse(requireEnv("WVO_FIREBASE_SERVICE_ACCOUNT_JSON"));
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
}

export interface MintedLicense {
  key: string;
  tier: LicenseTier;
}

export async function mintLicenseForPurchase(params: {
  tier: LicenseTier;
  notes: string;
}): Promise<MintedLicense> {
  const db = getDb();
  const doc = await mintLicense(db, { tier: params.tier, notes: params.notes });
  return { key: doc.key, tier: doc.tier };
}

/**
 * Atomically claims a Stripe Checkout Session id so a retried webhook
 * delivery can't mint a second license for the same payment. Returns false
 * if this session was already claimed (i.e. this delivery is a duplicate).
 */
export async function claimStripeSession(sessionId: string): Promise<boolean> {
  const db = getDb();
  try {
    await db.collection("stripeEvents").doc(sessionId).create({
      sessionId,
      claimedAt: new Date().toISOString(),
    });
    return true;
  } catch (error: unknown) {
    const code = (error as { code?: number })?.code;
    if (code === 6 /* ALREADY_EXISTS */) {
      return false;
    }
    throw error;
  }
}

export async function recordStripeSessionResult(
  sessionId: string,
  data: { licenseKey: string; emailedAt: string | null }
): Promise<void> {
  const db = getDb();
  await db.collection("stripeEvents").doc(sessionId).set(data, { merge: true });
}
