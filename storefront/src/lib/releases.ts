import type { LicenseTier } from "./stripe";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

/**
 * Direct download URLs for the two generic, self-serve installer builds
 * (one per tier, no per-customer .env.local bundled — see the approved plan's
 * "Explicitly manual / out of scope" section for how those builds are made).
 */
export function downloadUrlForTier(tier: LicenseTier): string {
  return tier === "base"
    ? requireEnv("GITHUB_RELEASE_URL_BASE")
    : requireEnv("GITHUB_RELEASE_URL_PLUS");
}
