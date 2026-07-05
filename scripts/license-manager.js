const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

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

function generateKey() {
  const segment = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `WVO-${segment()}-${segment()}-${segment()}-${segment()}`;
}

async function createLicense() {
  const key = generateKey();
  const licenseRef = db.collection('licenses').doc(key);
  
  await licenseRef.set({
    key: key,
    machineId: null,
    active: true,
    createdAt: FieldValue.serverTimestamp()
  });

  console.log(`\n✅ Success! New License Key Generated:`);
  console.log(`\n   ${key}\n`);
  console.log(`This key is now active in Firestore and ready to be given to a customer.`);
  process.exit(0);
}

createLicense().catch(console.error);
