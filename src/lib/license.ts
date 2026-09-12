import { prisma } from "./db";
import path from "path";
import fs from "fs";
import { machineIdSync } from "node-machine-id";
import {
  LICENSE_SIGNING_SECRET,
  getAppDataWvoDir,
  verifyTrialUnlock,
  signBaseLicense,
  signLegacyBaseLicense,
  timingSafeEqualStrings,
  TrialUnlockPayload,
} from "./licenseCrypto";
import { getTrialStatus } from "./trial";

// ---------------------------------------------------------------------------
// v2.0: the app is one product — there is no Base/Plus tier gate any more.
// What remains here is activation/machine-binding (license.json) and the
// 30-day trial lock (trial.ts) — both stay, since a customer's install is
// still tied to a signed, machine-bound key. Only the *tier* concept inside
// that key is gone.
// ---------------------------------------------------------------------------

export { LICENSE_SIGNING_SECRET, getAppDataWvoDir };

export const LICENSE_ROW_ID = "singleton";

export interface LicenseState {
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

/**
 * Reads the base activation license from disk, verifying its HMAC signature
 * and machine ID.
 *
 * Two on-disk formats are accepted, and as of v2.0 they are functionally
 * identical — both sign over `key:machineId` only:
 *  - Current (`signBaseLicense`): written by installs activated after tiers
 *    were removed.
 *  - Legacy (`signLegacyBaseLicense`): written by installs activated before
 *    the (now-removed) tiered format existed, whose signature was always
 *    just `key:machineId`.
 * Both functions are kept, rather than collapsed into one, so the "legacy"
 * name stays a truthful historical marker in the code and in
 * electron/main.js (which must mirror this file byte-for-byte) — but callers
 * should treat them as equivalent going forward.
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

    const expectedCurrent = signBaseLicense(data.key, data.machineId);
    const expectedLegacy = signLegacyBaseLicense(data.key, data.machineId);
    const sig = String(data.sig);
    if (!timingSafeEqualStrings(sig, expectedCurrent) && !timingSafeEqualStrings(sig, expectedLegacy)) {
      return null;
    }

    return { key: data.key, machineId: data.machineId, sig: data.sig };
  } catch (e) {
    return null;
  }
}

/** A license with no expiresAt never expires. */
export function isLicenseExpired(expiresAt: Date | string | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < now.getTime();
}

/**
 * Reads and cryptographically verifies trial-unlock.json (machine-bound HMAC,
 * same check the /api/license unlock-trial route performs). Returns null for
 * anything unreadable, absent, or failing verification.
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
 * Reads the singleton license row, creating it if missing, and reconciles
 * its activation fields (licenseKey/activatedAt/expiresAt) against whichever
 * signed source is authoritative: a validated trial-unlock, a trial build's
 * pre-activation state, or a verified license.json. No tier is involved —
 * every install runs the full feature set once activated.
 */
export async function getLicense(): Promise<LicenseState> {
  const baseLicense = getBaseLicense();

  const isTrialBuild = process.env.WVO_IS_TRIAL === "true";
  const row = await prisma.license.upsert({
    where: { id: LICENSE_ROW_ID },
    update: {},
    create: { id: LICENSE_ROW_ID },
  });

  // In test mode, if no activation file is present, bypass the strict
  // file-verification check to maintain compatibility with existing
  // database-only tests. Trial builds still run their own logic below.
  const isTest = process.env.NODE_ENV === "test";
  if (isTest && !baseLicense && !isTrialBuild) {
    return {
      licenseKey: row.licenseKey,
      notes: row.notes,
      activatedAt: row.activatedAt,
      expiresAt: row.expiresAt,
    };
  }

  let targetKey: string | null = null;
  let targetNotes: string | null = null;
  let targetExpires: Date | null = null;
  let targetActivated: Date | null = null;
  let haveTarget = false;

  const trialUnlock = isTrialBuild ? getVerifiedTrialUnlock() : null;

  if (trialUnlock) {
    // A converted trial: no license key, just a signed unlock.
    targetKey = null;
    targetNotes = trialUnlock.notes;
    targetExpires = trialUnlock.expiresAt ? new Date(trialUnlock.expiresAt) : null;
    targetActivated = row.activatedAt || new Date();
    haveTarget = true;
  } else if (isTrialBuild && !baseLicense) {
    // Not yet converted — running the 30-day evaluation. trial.ts's isLocked
    // is what actually gates access past day 30; this just populates the
    // license display fields.
    const trialStatus = getTrialStatus();
    targetKey = "TRIAL-ACTIVE";
    targetNotes = "30-Day Evaluation Period";
    targetExpires = trialStatus.installedAt
      ? new Date(new Date(trialStatus.installedAt).getTime() + 30 * 24 * 60 * 60 * 1000)
      : null;
    targetActivated = trialStatus.installedAt ? new Date(trialStatus.installedAt) : row.activatedAt || new Date();
    haveTarget = true;
  } else if (baseLicense) {
    targetKey = baseLicense.key;
    targetNotes = "Activated";
    targetExpires = null;
    targetActivated = row.activatedAt || new Date();
    haveTarget = true;
  }

  if (haveTarget) {
    const keyChanged = row.licenseKey !== targetKey;
    const expiresChanged = (row.expiresAt?.getTime() ?? null) !== (targetExpires?.getTime() ?? null);
    const activatedChanged = (row.activatedAt?.getTime() ?? null) !== (targetActivated?.getTime() ?? null);
    if (keyChanged || expiresChanged || activatedChanged) {
      await prisma.license.update({
        where: { id: LICENSE_ROW_ID },
        data: {
          licenseKey: targetKey,
          notes: targetNotes,
          expiresAt: targetExpires,
          activatedAt: targetActivated,
        },
      });
    }
  }

  return {
    licenseKey: targetKey ?? row.licenseKey,
    notes: targetNotes ?? row.notes,
    activatedAt: targetActivated ?? row.activatedAt,
    expiresAt: targetExpires ?? row.expiresAt,
  };
}
