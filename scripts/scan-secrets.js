#!/usr/bin/env node
// Lightweight pre-commit secret scanner (gitleaks-style backstop).
// Blocks the commit if staged files look like credentials, or contain
// obvious secret patterns, even if .gitignore should have caught them
// (e.g. a forced `git add -f`).

const { execSync } = require("child_process");
const path = require("path");

const BLOCKED_FILENAME_PATTERNS = [
  /\.env(\..+)?$/i,
  /service[-_]?account.*\.json$/i,
  /\.key\.json$/i,
  /^license\.json$/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
];

const CONTENT_PATTERNS = [
  { name: "Firebase/GCP private key", re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
  { name: "AWS access key ID", re: /AKIA[0-9A-Z]{16}/ },
  { name: "AWS secret access key assignment", re: /aws_secret_access_key\s*=\s*['"][A-Za-z0-9/+=]{40}['"]/i },
  { name: "GCP service account private_key field", re: /"private_key"\s*:\s*"-----BEGIN/ },
  // Skipped for .md files: documentation legitimately shows example env-var
  // syntax (e.g. `SESSION_SECRET="<example>"` in a setup guide), which this
  // pattern can't distinguish from a real leaked value. Code/config files
  // still get scanned — real secrets don't belong in either, but false
  // positives here were specifically drowning out real findings in docs.
  //
  // "apiKey" is deliberately excluded from the keyword list below: unlike
  // "secret"/"password"/"token", it's commonly a value meant to be public
  // (Firebase web config, Google Maps JS keys, Stripe publishable keys all
  // match this exact shape). Real secret API keys have their own dedicated
  // patterns above (AWS, Slack, etc.) — this catch-all doesn't need to also
  // cover "apiKey" and gain nothing but noise from doing so.
  { name: "Generic long secret/token assignment", re: /(secret|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-/+=]{20,}['"]/i, skipExtensions: [".md"] },
  { name: "Slack token", re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
];

function getStagedFiles() {
  const out = execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" });
  return out.split("\n").map((f) => f.trim()).filter(Boolean);
}

function main() {
  const files = getStagedFiles();
  const violations = [];

  for (const file of files) {
    if (BLOCKED_FILENAME_PATTERNS.some((re) => re.test(file))) {
      violations.push(`${file}: filename matches a blocked secret pattern`);
      continue;
    }

    let content;
    try {
      content = execSync(`git show :"${file}"`, { encoding: "utf8", maxBuffer: 1024 * 1024 * 20 });
    } catch {
      continue; // binary or unreadable — skip content scan
    }

    const ext = path.extname(file).toLowerCase();
    for (const { name, re, skipExtensions } of CONTENT_PATTERNS) {
      if (skipExtensions?.includes(ext)) continue;
      if (re.test(content)) {
        violations.push(`${file}: matches "${name}" pattern`);
      }
    }
  }

  if (violations.length > 0) {
    console.error("\n❌ Commit blocked — possible secret(s) detected:\n");
    for (const v of violations) console.error(`   ${v}`);
    console.error("\nIf this is a false positive, remove the offending content or rename the");
    console.error("file, then re-stage. Do not bypass this check with --no-verify unless you");
    console.error("are certain the match is safe.\n");
    process.exit(1);
  }
}

main();
