import fs from "fs";
import path from "path";
import crypto from "crypto";
import { machineIdSync } from "node-machine-id";
import {
  getAppDataWvoDir,
  LICENSE_SIGNING_SECRET,
  timingSafeEqualStrings,
  signTrialUnlock,
  verifyTrialUnlock,
  TrialUnlockPayload,
} from "./licenseCrypto";

// ---------------------------------------------------------------------------
// Trial-lock for demo installers (WVO_IS_TRIAL=true builds only). A trial
// install runs with the full feature set for 30 days from first launch, then
// locks the whole app until a signed unlock key (see verifyTrialUnlock) is
// applied.
// ---------------------------------------------------------------------------

export { signTrialUnlock, verifyTrialUnlock };
export type { TrialUnlockPayload };

const TRIAL_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;

export interface TrialAnchor {
  installedAt: string;
  machineId: string;
  sig: string;
}

export interface TrialStatus {
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

function signAnchor(installedAt: string, machineId: string): string {
  return crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(`${installedAt}:${machineId}`)
    .digest("hex");
}

/** Writes trial-unlock.json. Its mere presence permanently defeats the trial lock. */
export function markTrialUnlocked(payload: TrialUnlockPayload): void {
  const dir = getAppDataWvoDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getTrialUnlockPath(), JSON.stringify(payload, null, 2), "utf8");
}

/**
 * Reads (or lazily creates, mirroring getLicense()'s self-healing DB upsert)
 * the trial anchor and computes lock state. No-op for non-trial builds.
 */
export function getTrialStatus(now: Date = new Date()): TrialStatus {
  if (process.env.WVO_IS_TRIAL !== "true") {
    return { isTrial: false, daysRemaining: 0, isLocked: false, machineId: null };
  }

  const machineId = machineIdSync();

  const unlockPath = getTrialUnlockPath();
  let trialUnlocked = false;
  if (fs.existsSync(unlockPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
      if (verifyTrialUnlock(data, machineId)) {
        trialUnlocked = true;
      }
    } catch {
      // ignore
    }
  }

  if (trialUnlocked) {
    return { isTrial: true, daysRemaining: 0, isLocked: false, machineId };
  }

  try {
    const anchorPath = getTrialAnchorPath();
    let anchor: TrialAnchor;
    if (fs.existsSync(anchorPath)) {
      anchor = JSON.parse(fs.readFileSync(anchorPath, "utf8"));
    } else {
      const installedAt = now.toISOString();
      anchor = { installedAt, machineId, sig: signAnchor(installedAt, machineId) };
      const dir = getAppDataWvoDir();
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(anchorPath, JSON.stringify(anchor, null, 2), "utf8");
    }

    const sigValid = timingSafeEqualStrings(anchor.sig, signAnchor(anchor.installedAt, anchor.machineId));
    const elapsedMs = now.getTime() - new Date(anchor.installedAt).getTime();
    const daysRemaining = Math.max(0, Math.ceil((TRIAL_LENGTH_MS - elapsedMs) / (24 * 60 * 60 * 1000)));
    const isLocked = !sigValid || elapsedMs >= TRIAL_LENGTH_MS;

    return { isTrial: true, daysRemaining, isLocked, machineId, installedAt: anchor.installedAt };
  } catch {
    // Corrupt/unreadable anchor (truncated JSON, disk error, etc). Fail
    // closed rather than let this throw out of the login route and 500 every
    // login — a locked trial is safe; an unhandled exception is not.
    return { isTrial: true, daysRemaining: 0, isLocked: true, machineId };
  }
}
