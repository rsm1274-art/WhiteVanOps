import { Resend } from "resend";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

const resend = new Resend(requireEnv("RESEND_API_KEY"));

export async function sendLicenseEmail(params: {
  to: string;
  licenseKey: string;
  downloadUrl: string;
}): Promise<void> {
  const { to, licenseKey, downloadUrl } = params;

  await resend.emails.send({
    from: requireEnv("RESEND_FROM_EMAIL"),
    to,
    subject: `Your WhiteVanOps download and license key`,
    text:
      `Thanks for purchasing WhiteVanOps!\n\n` +
      `Download the installer:\n${downloadUrl}\n\n` +
      `Your activation key (enter this in the activation window on first launch):\n${licenseKey}\n\n` +
      `Keep this email — you'll need the key again if you ever have to reinstall.`,
  });
}
