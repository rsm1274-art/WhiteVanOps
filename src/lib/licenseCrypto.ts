import path from "path";
import os from "os";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Shared low-level crypto/paths for the license system. This is a leaf module —
// it must never import from license.ts or trial.ts, both of which import from
// here. (license.ts needs to verify trial-unlock.json to honor the unlocked
// tier; trial.ts already needed these; a license.ts <-> trial.ts import would
// cycle.)
// ---------------------------------------------------------------------------

export const LICENSE_SIGNING_SECRET = "wvo.lic.v1.6b2f9d4c8a1e7035f2c9b0d4e6a8135790acdef1234567890fedcba098765";

/** Resolves platform-specific AppData directory for WhiteVanOps */
export function getAppDataWvoDir(): string {
  const appData =
    process.env.APPDATA ||
    (process.platform === "darwin"
      ? path.join(os.homedir(), "Library/Application Support")
      : path.join(os.homedir(), ".config"));
  return path.join(appData, "whitevanops");
}

export function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export interface TrialUnlockPayload {
  machineId: string;
  tier: "base" | "plus";
  expiresAt: string | null;
  notes: string | null;
  sig: string;
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
