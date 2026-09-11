const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const args = process.argv.slice(2);
const isUnlockTrialMode = args.includes("--unlock-trial");

if (isUnlockTrialMode) {
  const machineIdx = args.indexOf("--machine");
  const expiresIdx = args.indexOf("--expires");
  const notesIdx = args.indexOf("--notes");

  const machineId = machineIdx !== -1 ? args[machineIdx + 1]?.trim() : null;

  if (!machineId) {
    console.error("Error: --machine <machineId> is required in --unlock-trial mode");
    console.error("Usage: node scripts/license-manager.js --unlock-trial --machine <machineId> [--expires <YYYY-MM-DD>] [--notes <notes>]");
    process.exit(1);
  }

  let expiresAt = null;
  if (expiresIdx !== -1 && expiresIdx + 1 < args.length) {
    const expStr = args[expiresIdx + 1].trim();
    const date = new Date(expStr);
    if (isNaN(date.getTime())) {
      console.error(`Error: Invalid expiry date '${expStr}'. Use YYYY-MM-DD format.`);
      process.exit(1);
    }
    expiresAt = date.toISOString();
  }

  let notes = null;
  if (notesIdx !== -1 && notesIdx + 1 < args.length) {
    notes = args[notesIdx + 1].trim();
  } else {
    notes = `Trial converted on ${new Date().toISOString().split("T")[0]}`;
  }

  const LICENSE_SIGNING_SECRET = "wvo.lic.v1.6b2f9d4c8a1e7035f2c9b0d4e6a8135790acdef1234567890fedcba098765";
  const signatureData = `${machineId}:${expiresAt || ""}`;
  const sig = crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(signatureData)
    .digest("hex");

  const payload = { machineId, expiresAt, notes, sig };

  console.log(`\n✅ Success! Trial Activation Key Generated:`);
  console.log(`\n${JSON.stringify(payload, null, 2)}\n`);
  console.log("Send the JSON block above to the customer. They paste it into Settings → License & Plan (or the trial-expired screen) to convert their install.");
  process.exit(0);
}

require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// The Firebase service-account key is a highly sensitive credential and must
// NOT live inside the repository tree (a stray `git add .` would publish it).
// Point WVO_FIREBASE_SERVICE_ACCOUNT (or GOOGLE_APPLICATION_CREDENTIALS) at a
// copy stored OUTSIDE the project, e.g. %APPDATA%\whitevanops-secrets\firebase-service-account.json.
// The in-repo path is only kept as a last-resort fallback and is gitignored.
const serviceAccountPath =
  process.env.WVO_FIREBASE_SERVICE_ACCOUNT ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.join(__dirname, "..", "firebase-service-account.json");

if (!fs.existsSync(serviceAccountPath)) {
  console.error(`Error: Firebase service-account key not found at: ${serviceAccountPath}`);
  console.error("Set WVO_FIREBASE_SERVICE_ACCOUNT to the absolute path of your key file");
  console.error("(store it OUTSIDE the repo — never commit it).");
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

const { mintLicense } = require("../shared/license-mint");

async function createLicense() {
  const notesIdx = args.indexOf("--notes");
  const notes = notesIdx !== -1 && notesIdx + 1 < args.length ? args[notesIdx + 1].trim() : null;

  const { key } = await mintLicense(db, { notes });

  console.log(`\n✅ Success! New License Key Generated:`);
  console.log(`\n   ${key}\n`);
  console.log(`This key is now active in Firestore and ready to be given to a customer.`);
  console.log(`\n⚠️  Record this key against the customer's name — you will need it to`);
  console.log(`   free the machine lock if they ever replace their PC.`);
  process.exit(0);
}

createLicense().catch(console.error);
