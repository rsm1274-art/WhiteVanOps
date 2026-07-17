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
  const baseKey = "WVO-DEV-LOCAL-ACTIVATION";

  // 1. Generate Base License (license.json).
  // The signature covers the tier — mirrors signBaseLicense() in
  // src/lib/licenseCrypto.ts and signLicense() in electron/main.js. The dev
  // activation is minted as tier "base"; the plus_license.json written below
  // is what grants Plus locally, so dev exercises the same signed-upgrade path
  // a real Base customer takes rather than a shortcut only dev has.
  const baseTier = "base";
  const baseSig = crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(`${baseKey}:${machineId}:${baseTier}`)
    .digest("hex");

  const baseLicense = {
    key: baseKey,
    machineId,
    tier: baseTier,
    sig: baseSig
  };

  const baseLicensePath = path.join(targetDir, "license.json");
  fs.writeFileSync(baseLicensePath, JSON.stringify(baseLicense, null, 2), "utf8");
  console.log(`✅ Base license successfully written to: ${baseLicensePath}`);

  // 2. Generate Plus License (plus_license.json)
  const plusSig = crypto
    .createHmac("sha256", LICENSE_SIGNING_SECRET)
    .update(`${baseKey}:plus:`)
    .digest("hex");

  const plusLicense = {
    licenseKey: baseKey,
    tier: "plus",
    expiresAt: null,
    notes: "Developer Local Activation",
    sig: plusSig
  };

  const plusLicensePath = path.join(targetDir, "plus_license.json");
  fs.writeFileSync(plusLicensePath, JSON.stringify(plusLicense, null, 2), "utf8");
  console.log(`✅ Plus tier license successfully written to: ${plusLicensePath}`);

  console.log("\n🚀 Development install has been fully activated with Base + Plus tier!");
}

activate();
