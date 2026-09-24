import fs from "fs";
import path from "path";
import { machineIdSync } from "node-machine-id";
import {
  getAppDataWvoDir,
  timingSafeEqualStrings,
  signTrialAnchor,
  signTrialUnlock,
  verifyTrialUnlock,
  readVerifiedBaseLicense,
  readVerifiedTrialUnlock,
  TrialUnlockPayload,
  TrialAnchor,
} from "./licenseCrypto";

// ---------------------------------------------------------------------------
// 30-day trial. There is one installer: on first launch electron/main.js
// offers "enter an activation key" or "start a 30-day trial". Picking the
// trial writes a signed trial.json (and main.js mirrors it into the database
// so deleting the file can't restart the clock). This module only *reads*
// that state — it never creates a trial on its own, so a server with no
// trial.json (office PM2 box, dev) is simply not on a trial.
//
// Activation always wins: a verified license.json or trial-unlock.json means
// the install is no longer a trial, however old trial.json is.
// ---------------------------------------------------------------------------

export { signTrialUnlock, verifyTrialUnlock };
export type { TrialUnlockPayload, TrialAnchor };

export const TRIAL_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;

export interface TrialStatus {
  /** A trial is running or has ended, and the install isn't activated. */
  isTrial: boolean;
  daysRemaining: number;
  isLocked: boolean;
  machineId: string | null;
  installedAt?: string;
}

function getTrialAnchorPath(): string {
  return path.join(getAppDataWvoDir(), "trial.json");
}

function getTrialUnlockPath(): string {
  return path.join(getAppDataWvoDir(), "trial-unlock.json");
}

/** Writes trial-unlock.json (the offline conversion fallback). */
export function markTrialUnlocked(payload: TrialUnlockPayload): void {
  const dir = getAppDataWvoDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getTrialUnlockPath(), JSON.stringify(payload, null, 2), "utf8");
}

export function isActivated(machineId: string): boolean {
  return readVerifiedBaseLicense(machineId) !== null || readVerifiedTrialUnlock(machineId) !== null;
}

export function getTrialStatus(now: Date = new Date()): TrialStatus {
  const machineId = machineIdSync();

  if (isActivated(machineId)) {
    return { isTrial: false, daysRemaining: 0, isLocked: false, machineId };
  }

  const anchorPath = getTrialAnchorPath();
  if (!fs.existsSync(anchorPath)) {
    return { isTrial: false, daysRemaining: 0, isLocked: false, machineId };
  }

  try {
    const anchor: TrialAnchor = JSON.parse(fs.readFileSync(anchorPath, "utf8"));
    const sigValid =
      anchor.machineId === machineId &&
      typeof anchor.sig === "string" &&
      timingSafeEqualStrings(anchor.sig, signTrialAnchor(anchor.installedAt, anchor.machineId));
    const elapsedMs = now.getTime() - new Date(anchor.installedAt).getTime();
    const daysRemaining = Math.max(0, Math.ceil((TRIAL_LENGTH_MS - elapsedMs) / (24 * 60 * 60 * 1000)));
    const isLocked = !sigValid || !(elapsedMs < TRIAL_LENGTH_MS);

    return { isTrial: true, daysRemaining: sigValid ? daysRemaining : 0, isLocked, machineId, installedAt: anchor.installedAt };
  } catch {
    // Corrupt/unreadable anchor. Fail closed rather than let this throw out
    // of the login route and 500 every login — a locked trial is safe (the
    // data is untouched and an activation key unlocks it); an exception is not.
    return { isTrial: true, daysRemaining: 0, isLocked: true, machineId };
  }
}
