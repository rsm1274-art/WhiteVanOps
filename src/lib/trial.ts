import fs from "fs";
import path from "path";
import crypto from "crypto";
import { machineIdSync } from "node-machine-id";
import { getAppDataWvoDir, LICENSE_SIGNING_SECRET } from "./license";

// ---------------------------------------------------------------------------
// Trial-lock for demo installers (WVO_IS_TRIAL=true builds only). Independent
// of the Base/Plus tier gate in license.ts: a trial install runs on Plus for
// 30 days from first launch, then locks the whole app regardless of tier,
// until a signed unlock key (see verifyTrialUnlock) is applied.
// ---------------------------------------------------------------------------

const TRIAL_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;

export interface TrialAnchor {
  installedAt: string;
  machineId: string;
  sig: string;
}

export interface TrialUnlockPayload {
  machineId: string;
  tier: "base" | "plus";
  expiresAt: string | null;
  notes: string | null;
  sig: string;
}

export interface TrialStatus {
  isTrial: boolean;
  daysRemaining: number;
  isLocked: boolean;
  machineId: string | null;
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

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/** Signs a trial-unlock payload. Used by tests and mirrored in scripts/license-manager.js for CLI key generation. */
export function signTrialUnlock(machineId: string, tier: "base" | "plus", expiresAt: string | null): string {
  return crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(`${machineId}:${tier}:${expiresAt || ""}`)
    .digest("hex");
}

/** Verifies a pasted activation key against THIS machine's real ID — never the payload's claimed machineId. */
export function verifyTrialUnlock(payload: unknown, machineId: string): payload is TrialUnlockPayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  if (p.machineId !== machineId) return false;
  if (p.tier !== "base" && p.tier !== "plus") return false;
  if (typeof p.sig !== "string") return false;
  const expiresAt = typeof p.expiresAt === "string" ? p.expiresAt : null;
  const expected = signTrialUnlock(machineId, p.tier, expiresAt);
  return timingSafeEqualStrings(p.sig, expected);
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

  if (fs.existsSync(getTrialUnlockPath())) {
    return { isTrial: true, daysRemaining: 0, isLocked: false, machineId };
  }

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

  return { isTrial: true, daysRemaining, isLocked, machineId };
}
