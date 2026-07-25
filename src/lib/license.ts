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
  verifyTrialPlan,
  signBaseLicense,
  signLegacyBaseLicense,
  timingSafeEqualStrings,
  TrialUnlockPayload,
  LicenseTier,
} from "./licenseCrypto";
import { getTrialStatus } from "./trial";

// ---------------------------------------------------------------------------
// License tier gating (Base vs Plus). Mirrors the requireRole shape in
// auth.ts: routes call `requirePlus(await hasPlusLicense())` alongside
// requireRole. The UI hiding Plus tabs is convenience only — every Plus API
// route must gate server-side with requirePlus.
// ---------------------------------------------------------------------------

export { LICENSE_SIGNING_SECRET, getAppDataWvoDir };
export type { LicenseTier };

export const LICENSE_ROW_ID = "singleton";

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
  /** The plan this key was sold with. Covered by `sig` — see getBaseLicense. */
  tier: LicenseTier;
  sig: string;
}

export interface PlusLicense {
  licenseKey: string;
  tier: "plus";
  expiresAt: string | null;
  notes: string | null;
  sig: string;
}

/**
 * Reads the base activation license from disk, verifying its HMAC signature
 * and machine ID. The returned `tier` is the authoritative plan for an
 * activated install: it is part of the signed payload, so hand-editing
 * `"tier": "base"` to `"plus"` invalidates the signature and the file is
 * rejected outright — the app asks for activation rather than granting Plus.
 *
 * Two on-disk formats are accepted:
 *  - Tiered (current): has a `tier` field; signature covers key:machineId:tier.
 *  - Legacy (pre-tier): no `tier` field; signature covers key:machineId only.
 *    Read back as "base", which is all such installs ever were. This is what
 *    keeps installs activated before the tiered format from being forced
 *    through re-activation.
 */
export function getBaseLicense(): BaseLicense | null {
  try {
    const dir = getAppDataWvoDir();
    const filePath = path.join(dir, "license.json");
    if (!fs.existsSync(filePath)) return null;

    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!data.key || !data.machineId || !data.sig) return null;

    // Verify against THIS machine's real id, never the file's claimed one.
    const hwid = machineIdSync();
    if (data.machineId !== hwid) return null;

    const isTiered = typeof data.tier === "string";
    const tier: LicenseTier = data.tier === "plus" ? "plus" : "base";
    const expected = isTiered
      ? signBaseLicense(data.key, data.machineId, tier)
      : signLegacyBaseLicense(data.key, data.machineId);

    if (!timingSafeEqualStrings(String(data.sig), expected)) return null;

    return { key: data.key, machineId: data.machineId, tier, sig: data.sig };
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

  // 3. Read the database state. The row is always created as "base": the tier
  // is never taken from configuration, only from a verified signature below.
  const isTrialBuild = process.env.WVO_IS_TRIAL === "true";
  const row = await prisma.license.upsert({
    where: { id: LICENSE_ROW_ID },
    update: {},
    create: { id: LICENSE_ROW_ID, tier: "base" },
  });

  // 4. In test mode, if no activation file is present, bypass the strict file-verification
  // check to maintain compatibility with existing database-only tests.
  // Trial builds (WVO_IS_TRIAL) always run their own tier logic below (force
  // Plus, or honor a validated trial-unlock.json) — including the anti-tamper
  // self-heal — so they must not take this test-only DB-passthrough shortcut.
  const isTest = process.env.NODE_ENV === "test";
  if (isTest && !baseLicense && !plusLicense && !isTrialBuild) {
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

  // Tier precedence. Every branch below is gated on something signed — a
  // machine-bound HMAC over the payload it is claiming. Configuration alone
  // (an env var, a DB column) never grants Plus: WVO_DEFAULT_TIER used to,
  // which meant editing one word of resources/nextjs/.env.local in Notepad
  // unlocked the paid tier. An activated install's tier now comes only from
  // its own signed license.json (or a signed upgrade bound to that key).
  //
  //   1. trial-unlock.json  — a paid day-30 conversion; outranks the trial's
  //      pre-activated Plus, so a base-tier unlock correctly drops Plus.
  //   2. trial build, not yet converted — the plan its SIGNED stamp grants,
  //      for the 30-day evaluation. Only reachable when NO base license
  //      exists, i.e. a genuine trial install (trial builds skip activation).
  //      The stamp is HMAC-signed and verifyTrialPlan fails closed to "base",
  //      so editing WVO_TRIAL_PLAN in the bundled .env.local grants nothing —
  //      the WVO_DEFAULT_TIER lesson, applied to the one plan input that
  //      genuinely has to come from the build.
  //   3. license.json's signed tier — a key sold as Plus.
  //   4. plus_license.json — a signed upgrade for an install sold as Base.
  const trialUnlock = isTrialBuild ? getVerifiedTrialUnlock() : null;

  if (trialUnlock) {
    targetTier = trialUnlock.tier;
    targetKey = null;
    targetNotes = trialUnlock.notes;
    targetExpires = trialUnlock.expiresAt ? new Date(trialUnlock.expiresAt) : null;
    targetActivated = row.activatedAt || new Date();
  } else if (isTrialBuild && !baseLicense) {
    const trialStatus = getTrialStatus();
    targetTier = verifyTrialPlan(process.env.WVO_TRIAL_PLAN, process.env.WVO_TRIAL_PLAN_SIG);
    targetKey = "TRIAL-ACTIVE";
    targetNotes = "30-Day Evaluation Period";
    targetExpires = trialStatus.installedAt ? new Date(new Date(trialStatus.installedAt).getTime() + 30 * 24 * 60 * 60 * 1000) : null;
    targetActivated = trialStatus.installedAt ? new Date(trialStatus.installedAt) : (row.activatedAt || new Date());
  } else if (baseLicense && baseLicense.tier === "plus") {
    targetTier = "plus";
    targetKey = baseLicense.key;
    targetNotes = "Activated via Plus license key";
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
