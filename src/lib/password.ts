// Shared password rules so every entry point (self-service change, admin
// create/reset) enforces the same minimum bar instead of drifting.
const WEAK_PASSWORDS = ["admin", "password", "12345678", "changeme"];

export function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (WEAK_PASSWORDS.includes(password.toLowerCase())) {
    return "Please choose a stronger password.";
  }
  return null;
}
