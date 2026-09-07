const crypto = require("crypto");

/**
 * Generates a license key in the WVO-XXXX-XXXX-XXXX-XXXX format.
 * Pure function, no I/O — shared by scripts/license-manager.js (CLI) and
 * storefront/'s Stripe webhook so both mint the exact same key shape.
 */
function generateLicenseKey() {
  const segment = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `WVO-${segment()}-${segment()}-${segment()}-${segment()}`;
}

/**
 * Writes a new license doc to Firestore under licenses/{key}. This shape is
 * load-bearing — electron/main.js's activation flow reads these exact fields
 * (key, machineId, tier, active) during activation.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {{ tier: "base" | "plus", notes?: string | null }} opts
 * @returns {Promise<{ key: string, machineId: null, tier: string, active: true, notes: string | null }>}
 */
async function mintLicense(db, { tier, notes = null }) {
  if (tier !== "base" && tier !== "plus") {
    throw new Error(`mintLicense: tier must be 'base' or 'plus' (got '${tier}')`);
  }

  const { FieldValue } = require("firebase-admin/firestore");
  const key = generateLicenseKey();
  const licenseRef = db.collection("licenses").doc(key);

  const doc = {
    key,
    machineId: null,
    tier,
    active: true,
    notes,
    createdAt: FieldValue.serverTimestamp(),
  };

  await licenseRef.set(doc);

  return doc;
}

module.exports = { generateLicenseKey, mintLicense };
