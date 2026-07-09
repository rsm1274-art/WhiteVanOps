import { NextResponse } from "next/server";
import { prisma } from "./db";

// ---------------------------------------------------------------------------
// License tier gating (Base vs Plus). Mirrors the requireRole shape in
// auth.ts: routes call `requirePlus(await hasPlusLicense())` alongside
// requireRole. The UI hiding Plus tabs is convenience only — every Plus API
// route must gate server-side with requirePlus.
// ---------------------------------------------------------------------------

export const LICENSE_ROW_ID = "singleton";

export type LicenseTier = "base" | "plus";

export interface LicenseState {
  tier: LicenseTier;
  licenseKey: string | null;
  notes: string | null;
  activatedAt: Date | null;
  expiresAt: Date | null;
}

/** A license with no expiresAt never expires. */
export function isLicenseExpired(expiresAt: Date | string | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < now.getTime();
}

/** Plus features are active only on an unexpired "plus" tier. */
export function isPlusActive(
  license: { tier: string; expiresAt: Date | string | null },
  now: Date = new Date()
): boolean {
  return license.tier === "plus" && !isLicenseExpired(license.expiresAt, now);
}

/**
 * Reads the singleton license row, creating it (tier "base") if missing —
 * upsert-on-read so every install path (Electron bootstrap, migrate deploy,
 * dev seed) self-heals without a seed-script dependency.
 */
export async function getLicense(): Promise<LicenseState> {
  const row = await prisma.license.upsert({
    where: { id: LICENSE_ROW_ID },
    update: {},
    create: { id: LICENSE_ROW_ID },
  });
  return {
    tier: row.tier === "plus" ? "plus" : "base",
    licenseKey: row.licenseKey,
    notes: row.notes,
    activatedAt: row.activatedAt,
    expiresAt: row.expiresAt,
  };
}

export async function hasPlusLicense(): Promise<boolean> {
  return isPlusActive(await getLicense());
}

/** Returns a 403 response when Plus isn't licensed, otherwise null. */
export function requirePlus(licensed: boolean): NextResponse | null {
  if (!licensed) {
    return NextResponse.json(
      { error: "This feature requires a WhiteVanOps Plus license" },
      { status: 403 }
    );
  }
  return null;
}
