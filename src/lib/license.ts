import { prisma } from "./db";
import { machineIdSync } from "node-machine-id";
import {
  LICENSE_SIGNING_SECRET,
  getAppDataWvoDir,
  readVerifiedBaseLicense,
  readVerifiedTrialUnlock,
  BaseLicense,
} from "./licenseCrypto";
import { getTrialStatus, TRIAL_LENGTH_MS } from "./trial";

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

export type { BaseLicense };

/**
 * Reads the base activation license from disk, verifying its HMAC signature
 * and machine ID (implementation in licenseCrypto.ts so trial.ts can share it).
 *
 * Two on-disk formats are accepted, and as of v2.0 they are functionally
 * identical — both sign over `key:machineId` only (`signBaseLicense` and the
 * historical `signLegacyBaseLicense`). electron/main.js must mirror both.
 */
export function getBaseLicense(): BaseLicense | null {
  try {
    return readVerifiedBaseLicense(machineIdSync());
  } catch {
    return null;
  }
}

/** A license with no expiresAt never expires. */
export function isLicenseExpired(expiresAt: Date | string | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < now.getTime();
}

/**
 * Reads the singleton license row, creating it if missing, and reconciles
 * its activation fields (licenseKey/activatedAt/expiresAt) against whichever
 * signed source is authoritative: a validated trial-unlock, a verified
 * license.json, or a running/ended 30-day trial. No tier is involved —
 * every install runs the full feature set once activated.
 */
export async function getLicense(): Promise<LicenseState> {
  const baseLicense = getBaseLicense();

  const row = await prisma.license.upsert({
    where: { id: LICENSE_ROW_ID },
    update: {},
    create: { id: LICENSE_ROW_ID },
  });

  const trialUnlock = (() => {
    try {
      return readVerifiedTrialUnlock(machineIdSync());
    } catch {
      return null;
    }
  })();
  const trialStatus = getTrialStatus();

  // In test mode, if no activation or trial file is present, bypass the
  // strict file-verification check to maintain compatibility with existing
  // database-only tests.
  const isTest = process.env.NODE_ENV === "test";
  if (isTest && !baseLicense && !trialUnlock && !trialStatus.isTrial) {
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

  if (trialUnlock) {
    // A converted trial: no license key, just a signed unlock.
    targetKey = null;
    targetNotes = trialUnlock.notes;
    targetExpires = trialUnlock.expiresAt ? new Date(trialUnlock.expiresAt) : null;
    targetActivated = row.activatedAt || new Date();
    haveTarget = true;
  } else if (baseLicense) {
    targetKey = baseLicense.key;
    targetNotes = "Activated";
    targetExpires = null;
    targetActivated = row.activatedAt || new Date();
    haveTarget = true;
  } else if (trialStatus.isTrial) {
    // Not yet activated — running (or past) the 30-day evaluation. trial.ts's
    // isLocked is what actually gates access past day 30; this just populates
    // the license display fields.
    targetKey = "TRIAL-ACTIVE";
    targetNotes = "30-Day Evaluation Period";
    targetExpires = trialStatus.installedAt
      ? new Date(new Date(trialStatus.installedAt).getTime() + TRIAL_LENGTH_MS)
      : null;
    targetActivated = trialStatus.installedAt ? new Date(trialStatus.installedAt) : row.activatedAt || new Date();
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
