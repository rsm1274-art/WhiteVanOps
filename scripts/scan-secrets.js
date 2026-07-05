#!/usr/bin/env node
// Lightweight pre-commit secret scanner (gitleaks-style backstop).
// Blocks the commit if staged files look like credentials, or contain
// obvious secret patterns, even if .gitignore should have caught them
// (e.g. a forced `git add -f`).

const { execSync } = require("child_process");

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
  { name: "Generic long secret/token assignment", re: /(secret|password|token|api_?key)\s*[:=]\s*['"][A-Za-z0-9_\-/+=]{20,}['"]/i },
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

    for (const { name, re } of CONTENT_PATTERNS) {
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
