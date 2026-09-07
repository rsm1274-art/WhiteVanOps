import { Resend } from "resend";
import type { LicenseTier } from "./stripe";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

const resend = new Resend(requireEnv("RESEND_API_KEY"));

const TIER_LABEL: Record<LicenseTier, string> = {
  base: "WhiteVanOps Base",
  plus: "WhiteVanOps Plus",
};

export async function sendLicenseEmail(params: {
  to: string;
  tier: LicenseTier;
  licenseKey: string;
  downloadUrl: string;
}): Promise<void> {
  const { to, tier, licenseKey, downloadUrl } = params;
  const label = TIER_LABEL[tier];

  await resend.emails.send({
    from: requireEnv("RESEND_FROM_EMAIL"),
    to,
    subject: `Your ${label} download and license key`,
    text:
      `Thanks for purchasing ${label}!\n\n` +
      `Download the installer:\n${downloadUrl}\n\n` +
      `Your activation key (enter this in the activation window on first launch):\n${licenseKey}\n\n` +
      `Keep this email — you'll need the key again if you ever have to reinstall.`,
  });
}
