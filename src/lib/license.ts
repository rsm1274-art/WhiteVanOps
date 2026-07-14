import { NextResponse } from "next/server";
import { prisma } from "./db";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { machineIdSync } from "node-machine-id";
import {
  LICENSE_SIGNING_SECRET,
  getAppDataWvoDir,
  verifyTrialUnlock,
  TrialUnlockPayload,
} from "./licenseCrypto";

// ---------------------------------------------------------------------------
// License tier gating (Base vs Plus). Mirrors the requireRole shape in
// auth.ts: routes call `requirePlus(await hasPlusLicense())` alongside
// requireRole. The UI hiding Plus tabs is convenience only — every Plus API
// route must gate server-side with requirePlus.
// ---------------------------------------------------------------------------

export { LICENSE_SIGNING_SECRET, getAppDataWvoDir };

export const LICENSE_ROW_ID = "singleton";

export type LicenseTier = "base" | "plus";

export interface LicenseState {
  tier: LicenseTier;
  licenseKey: string | null;
  notes: string | null;
  activatedAt: Date | null;
  expiresAt: Date | null;
}

export interface BaseLicense {
  key: string;
  machineId: string;
  sig: string;
}

export interface PlusLicense {
  licenseKey: string;
  tier: "plus";
  expiresAt: string | null;
  notes: string | null;
  sig: string;
}

/** Reads the base activation license from disk, verifying its HMAC signature and machine ID */
export function getBaseLicense(): BaseLicense | null {
  try {
    const dir = getAppDataWvoDir();
    const filePath = path.join(dir, "license.json");
    if (!fs.existsSync(filePath)) return null;

    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!data.key || !data.machineId || !data.sig) return null;

    // Verify machine ID
    const hwid = machineIdSync();
    if (data.machineId !== hwid) return null;

    // Verify signature
    const expected = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update(`${data.key}:${data.machineId}`)
      .digest("hex");

    const actualBuf = Buffer.from(String(data.sig));
    const expectedBuf = Buffer.from(expected);

    if (actualBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(actualBuf, expectedBuf)) return null;

    return data;
  } catch (e) {
    return null;
  }
}

/** Cryptographically verifies an offline Plus license upgrade against the active Base license key */
export function verifyPlusLicense(plusData: any, baseKey: string): boolean {
  if (!plusData || !plusData.licenseKey || plusData.tier !== "plus" || !plusData.sig) {
    return false;
  }
  if (plusData.licenseKey !== baseKey) {
    return false;
  }

  try {
    const signatureData = `${plusData.licenseKey}:${plusData.tier}:${plusData.expiresAt || ""}`;
    const expected = crypto
      .createHmac("sha256", LICENSE_SIGNING_SECRET)
      .update(signatureData)
      .digest("hex");

    const actualBuf = Buffer.from(String(plusData.sig));
    const expectedBuf = Buffer.from(expected);

    if (actualBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(actualBuf, expectedBuf);
  } catch (e) {
    return false;
  }
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
 * Reads and cryptographically verifies trial-unlock.json (machine-bound HMAC,
 * same check the /api/license unlock-trial route performs). Returns null for
 * anything unreadable, absent, or failing verification — callers fall back to
 * the existing tier logic in that case.
 */
function getVerifiedTrialUnlock(): TrialUnlockPayload | null {
  try {
    const unlockPath = path.join(getAppDataWvoDir(), "trial-unlock.json");
    if (!fs.existsSync(unlockPath)) return null;
    const data = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
    if (!verifyTrialUnlock(data, machineIdSync())) return null;
    return data as TrialUnlockPayload;
  } catch {
    return null;
  }
}

/**
 * Reads the singleton license row, creating it (tier "base") if missing.
 * Verifies the offline Plus upgrade signature if set to "plus", performing self-healing / auto-sync.
 */
export async function getLicense(): Promise<LicenseState> {
  // 1. Get the base license activation. If missing/invalid, we cannot run Plus.
  const baseLicense = getBaseLicense();

  // 2. Read plus_license.json if present
  let plusLicense: PlusLicense | null = null;
  const appDataDir = getAppDataWvoDir();
  const plusPath = path.join(appDataDir, "plus_license.json");

  if (baseLicense && fs.existsSync(plusPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(plusPath, "utf8"));
      if (verifyPlusLicense(data, baseLicense.key)) {
        plusLicense = data;
      }
    } catch (e) {
      // Ignore reading error
    }
  }

  // 3. Read the database state
  const defaultTier = process.env.WVO_DEFAULT_TIER === "plus" ? "plus" : "base";
  const row = await prisma.license.upsert({
    where: { id: LICENSE_ROW_ID },
    update: {},
    create: { id: LICENSE_ROW_ID, tier: defaultTier },
  });

  // 4. In test mode, if no activation file is present, bypass the strict file-verification
  // check to maintain compatibility with existing database-only tests.
  // Trial builds (WVO_IS_TRIAL) always run their own tier logic below (force
  // Plus, or honor a validated trial-unlock.json) — including the anti-tamper
  // self-heal — so they must not take this test-only DB-passthrough shortcut.
  const isTest = process.env.NODE_ENV === "test";
  if (isTest && !baseLicense && !plusLicense && defaultTier !== "plus" && process.env.WVO_IS_TRIAL !== "true") {
    return {
      tier: row.tier === "plus" ? "plus" : "base",
      licenseKey: row.licenseKey,
      notes: row.notes,
      activatedAt: row.activatedAt,
      expiresAt: row.expiresAt,
    };
  }

  // 5. Determine the target license state based on cryptographic validation
  let targetTier: LicenseTier = "base";
  let targetKey: string | null = null;
  let targetNotes: string | null = null;
  let targetExpires: Date | null = null;
  let targetActivated: Date | null = null;

  // A validated trial-unlock.json (day-30 conversion) outranks the trial's
  // pre-activated-Plus default: the unlocked tier — base or plus — is what
  // actually runs, not whatever the build was stamped with.
  const trialUnlock = process.env.WVO_IS_TRIAL === "true" ? getVerifiedTrialUnlock() : null;

  if (trialUnlock) {
    targetTier = trialUnlock.tier;
    targetKey = null;
    targetNotes = trialUnlock.notes;
    targetExpires = trialUnlock.expiresAt ? new Date(trialUnlock.expiresAt) : null;
    targetActivated = row.activatedAt || new Date();
  } else if (defaultTier === "plus") {
    targetTier = "plus";
    targetKey = "PRE-ACTIVATED-PLUS-BUILD";
    targetNotes = "Activated via Plus Installer Build";
    targetExpires = null;
    targetActivated = row.activatedAt || new Date();
  } else if (baseLicense && plusLicense && !isLicenseExpired(plusLicense.expiresAt)) {
    targetTier = "plus";
    targetKey = plusLicense.licenseKey;
    targetNotes = plusLicense.notes;
    targetExpires = plusLicense.expiresAt ? new Date(plusLicense.expiresAt) : null;
    targetActivated = row.activatedAt || new Date();
  }

  const databaseSaysPlus = row.tier === "plus";
  const verifiedPlus = targetTier === "plus";

  if (databaseSaysPlus && !verifiedPlus) {
    // DB says Plus, but we couldn't verify it offline. Revert DB back to Base (anti-tampering).
    await prisma.license.update({
      where: { id: LICENSE_ROW_ID },
      data: {
        tier: "base",
        activatedAt: null,
      },
    });
    targetTier = "base";
    targetKey = row.licenseKey;
    targetNotes = row.notes;
    targetExpires = row.expiresAt;
    targetActivated = null;
  } else if (!databaseSaysPlus && verifiedPlus) {
    // Valid plus_license.json found, but DB is Base. Auto-upgrade/sync DB to Plus.
    await prisma.license.update({
      where: { id: LICENSE_ROW_ID },
      data: {
        tier: "plus",
        licenseKey: targetKey,
        notes: targetNotes,
        expiresAt: targetExpires,
        activatedAt: targetActivated,
      },
    });
  } else if (verifiedPlus) {
    // Both verified and DB say Plus. Ensure DB values match the file (e.g. if expiry changed).
    const keyChanged = row.licenseKey !== targetKey;
    const expiresChanged = (row.expiresAt?.getTime() ?? null) !== (targetExpires?.getTime() ?? null);
    if (keyChanged || expiresChanged) {
      await prisma.license.update({
        where: { id: LICENSE_ROW_ID },
        data: {
          licenseKey: targetKey,
          notes: targetNotes,
          expiresAt: targetExpires,
        },
      });
    }
  }

  return {
    tier: targetTier,
    licenseKey: targetKey ?? row.licenseKey,
    notes: targetNotes ?? row.notes,
    activatedAt: targetActivated ?? row.activatedAt,
    expiresAt: targetExpires ?? row.expiresAt,
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
