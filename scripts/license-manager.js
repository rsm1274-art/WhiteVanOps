const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const args = process.argv.slice(2);
const isPlusMode = args.includes("--plus");
const isUnlockTrialMode = args.includes("--unlock-trial");

if (isUnlockTrialMode) {
  const machineIdx = args.indexOf("--machine");
  const tierIdx = args.indexOf("--tier");
  const expiresIdx = args.indexOf("--expires");
  const notesIdx = args.indexOf("--notes");

  const machineId = machineIdx !== -1 ? args[machineIdx + 1]?.trim() : null;
  const tier = tierIdx !== -1 ? args[tierIdx + 1]?.trim() : null;

  if (!machineId || (tier !== "base" && tier !== "plus")) {
    console.error("Error: --machine <machineId> and --tier base|plus are required in --unlock-trial mode");
    console.error("Usage: node scripts/license-manager.js --unlock-trial --machine <machineId> --tier base|plus [--expires <YYYY-MM-DD>] [--notes <notes>]");
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
  const signatureData = `${machineId}:${tier}:${expiresAt || ""}`;
  const sig = crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(signatureData)
    .digest("hex");

  const payload = { machineId, tier, expiresAt, notes, sig };

  console.log(`\n✅ Success! Trial Activation Key Generated (tier: ${tier}):`);
  console.log(`\n${JSON.stringify(payload, null, 2)}\n`);
  console.log("Send the JSON block above to the customer. They paste it into Settings → License & Plan (or the trial-expired screen) to convert their install.");
  process.exit(0);
}

if (isPlusMode) {
  const keyIdx = args.indexOf("--key");
  const expiresIdx = args.indexOf("--expires");
  const notesIdx = args.indexOf("--notes");

  let licenseKey = "";
  if (keyIdx !== -1 && keyIdx + 1 < args.length) {
    licenseKey = args[keyIdx + 1].trim();
  }

  if (!licenseKey) {
    console.error("Error: --key <licenseKey> is required in --plus mode");
    console.error("Usage: node scripts/license-manager.js --plus --key <licenseKey> [--expires <YYYY-MM-DD>] [--notes <notes>]");
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

  let notes = "";
  if (notesIdx !== -1 && notesIdx + 1 < args.length) {
    notes = args[notesIdx + 1].trim();
  } else {
    notes = `Activated offline on ${new Date().toISOString().split('T')[0]}`;
  }

  const LICENSE_SIGNING_SECRET = "wvo.lic.v1.6b2f9d4c8a1e7035f2c9b0d4e6a8135790acdef1234567890fedcba098765";
  const signatureData = `${licenseKey}:plus:${expiresAt || ""}`;
  const sig = crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(signatureData)
    .digest("hex");

  const licensePayload = {
    licenseKey,
    tier: "plus",
    expiresAt,
    notes,
    sig
  };

  console.log(`\n✅ Success! Offline Plus Upgrade License Generated:`);
  console.log(`\n${JSON.stringify(licensePayload, null, 2)}\n`);
  console.log("Provide the JSON block above to the customer. They can paste it or save it as a file to apply it in Settings.");
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

// The tier is stamped onto the Firestore record at mint time and travels with
// the key: electron/main.js reads it during activation and bakes it into the
// machine-bound signed license.json. This is what replaced WVO_DEFAULT_TIER —
// a customer's plan is now proven by their key, not declared by a text file on
// their disk that they could edit.
function resolveTier() {
  const tierIdx = args.indexOf("--tier");
  if (tierIdx === -1) return "base";
  const tier = args[tierIdx + 1]?.trim();
  if (tier !== "base" && tier !== "plus") {
    console.error(`Error: --tier must be 'base' or 'plus' (got '${tier ?? ""}')`);
    console.error("Usage: node scripts/license-manager.js [--tier base|plus] [--notes <notes>]");
    process.exit(1);
  }
  return tier;
}

async function createLicense() {
  const tier = resolveTier();
  const notesIdx = args.indexOf("--notes");
  const notes = notesIdx !== -1 && notesIdx + 1 < args.length ? args[notesIdx + 1].trim() : null;

  const { key } = await mintLicense(db, { tier, notes });

  console.log(`\n✅ Success! New ${tier.toUpperCase()} License Key Generated:`);
  console.log(`\n   ${key}\n`);
  console.log(`Tier: ${tier}${tier === "base" ? `  (upgrade later with: --plus --key ${key})` : ""}`);
  console.log(`This key is now active in Firestore and ready to be given to a customer.`);
  console.log(`\n⚠️  Record this key against the customer's name — you will need it to`);
  console.log(`   free the machine lock if they ever replace their PC.`);
  process.exit(0);
}

createLicense().catch(console.error);
