const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { machineIdSync } = require("node-machine-id");

const LICENSE_SIGNING_SECRET = "wvo.lic.v1.6b2f9d4c8a1e7035f2c9b0d4e6a8135790acdef1234567890fedcba098765";

function getAppDataWvoDir() {
  const appData =
    process.env.APPDATA ||
    (process.platform === "darwin"
      ? path.join(os.homedir(), "Library/Application Support")
      : path.join(os.homedir(), ".config"));
  return path.join(appData, "whitevanops");
}

function activate() {
  const targetDir = getAppDataWvoDir();
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const machineId = machineIdSync();
  const key = "WVO-DEV-LOCAL-ACTIVATION";

  // Mirrors signBaseLicense() in src/lib/licenseCrypto.ts and signLicense() in
  // electron/main.js — v2.0 has no tier, so the signature covers key:machineId only.
  const sig = crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(`${key}:${machineId}`)
    .digest("hex");

  const license = { key, machineId, sig };

  const licensePath = path.join(targetDir, "license.json");
  fs.writeFileSync(licensePath, JSON.stringify(license, null, 2), "utf8");
  console.log(`✅ License successfully written to: ${licensePath}`);
  console.log("\n🚀 Development install has been fully activated.");
}

activate();
