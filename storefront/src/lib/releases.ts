function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

/**
 * Direct download URL for the generic, self-serve installer build (no
 * per-customer .env.local bundled — see the approved plan's "Explicitly
 * manual / out of scope" section for how those builds are made).
 */
export function downloadUrl(): string {
  return requireEnv("GITHUB_RELEASE_URL");
}
