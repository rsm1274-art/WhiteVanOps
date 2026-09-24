// 30-day trial, main-process side. One installer: on first launch the
// activation window offers "enter an activation key" or "start a 30-day
// trial". Starting the trial writes a signed trial.json in the app-data
// directory; once the database is up, the start date is also mirrored into
// the SystemSetting row "trial_anchor", and the EARLIEST valid date of the
// two wins. So deleting trial.json alone doesn't restart the clock — it is
// rewritten from the database — and deleting both means deleting the
// customer's own data.
//
// The server (src/lib/trial.ts) reads trial.json for its own lock; the
// signatures below MUST stay byte-identical to src/lib/licenseCrypto.ts
// (signTrialAnchor / signTrialUnlock), like signLicense in main.js.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TRIAL_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;
const DB_KEY = 'trial_anchor';

function signTrialAnchor(secret, installedAt, machineId) {
  return crypto.createHmac('sha256', secret).update(`${installedAt}:${machineId}`).digest('hex');
}

function signTrialUnlock(secret, machineId, expiresAt) {
  return crypto.createHmac('sha256', secret).update(`${machineId}:${expiresAt || ''}`).digest('hex');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** A parsed anchor object if its signature and machine id check out, else null. */
function verifyAnchor(secret, anchor, machineId) {
  if (!anchor || typeof anchor !== 'object') return null;
  if (anchor.machineId !== machineId || typeof anchor.installedAt !== 'string') return null;
  if (Number.isNaN(new Date(anchor.installedAt).getTime())) return null;
  if (!safeEqual(anchor.sig, signTrialAnchor(secret, anchor.installedAt, machineId))) return null;
  return anchor;
}

function anchorPath(dir) {
  return path.join(dir, 'trial.json');
}

function readAnchorFile(secret, dir, machineId) {
  try {
    return verifyAnchor(secret, JSON.parse(fs.readFileSync(anchorPath(dir), 'utf8')), machineId);
  } catch {
    return null;
  }
}

function trialFileExists(dir) {
  return fs.existsSync(anchorPath(dir));
}

function writeAnchorFile(secret, dir, installedAt, machineId) {
  fs.mkdirSync(dir, { recursive: true });
  const anchor = { installedAt, machineId, sig: signTrialAnchor(secret, installedAt, machineId) };
  fs.writeFileSync(anchorPath(dir), JSON.stringify(anchor, null, 2), 'utf8');
  return anchor;
}

/** The offline-conversion fallback written by POST /api/license unlock-trial. */
function hasValidTrialUnlock(secret, dir, machineId) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dir, 'trial-unlock.json'), 'utf8'));
    if (!p || p.machineId !== machineId || typeof p.sig !== 'string') return false;
    const expiresAt = typeof p.expiresAt === 'string' ? p.expiresAt : null;
    return safeEqual(p.sig, signTrialUnlock(secret, machineId, expiresAt));
  } catch {
    return false;
  }
}

/** { expired, daysRemaining } for a trial that started at `installedAt`. */
function trialState(installedAt, now = new Date()) {
  const elapsed = now.getTime() - new Date(installedAt).getTime();
  return {
    expired: !(elapsed < TRIAL_LENGTH_MS),
    daysRemaining: Math.max(0, Math.ceil((TRIAL_LENGTH_MS - elapsed) / (24 * 60 * 60 * 1000))),
  };
}

/**
 * Pure: the anchor to keep given the file's and the database's (each already
 * verified, or null). Earliest start wins; null if neither exists.
 */
function pickEarliest(fileAnchor, dbAnchor) {
  if (!fileAnchor) return dbAnchor;
  if (!dbAnchor) return fileAnchor;
  return new Date(dbAnchor.installedAt) < new Date(fileAnchor.installedAt) ? dbAnchor : fileAnchor;
}

/**
 * Syncs trial.json with the database copy (pg client, already connected).
 * Returns the effective anchor or null when this install never started a
 * trial. Only called when the install isn't activated.
 */
async function reconcileWithDb({ client, secret, dir, machineId }) {
  const fileAnchor = readAnchorFile(secret, dir, machineId);
  let dbAnchor = null;
  const { rows } = await client.query('SELECT value FROM "SystemSetting" WHERE key = $1', [DB_KEY]);
  if (rows.length > 0) {
    try { dbAnchor = verifyAnchor(secret, JSON.parse(rows[0].value), machineId); } catch { dbAnchor = null; }
  }

  const effective = pickEarliest(fileAnchor, dbAnchor);
  if (!effective) return null;

  if (!fileAnchor || fileAnchor.installedAt !== effective.installedAt) {
    writeAnchorFile(secret, dir, effective.installedAt, machineId);
  }
  if (!dbAnchor || dbAnchor.installedAt !== effective.installedAt) {
    await client.query(
      'INSERT INTO "SystemSetting" ("id","key","value") VALUES ($1,$2,$3) ' +
      'ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"',
      [crypto.randomUUID(), DB_KEY, JSON.stringify(effective)]
    );
  }
  return effective;
}

module.exports = {
  TRIAL_LENGTH_MS,
  DB_KEY,
  signTrialAnchor,
  verifyAnchor,
  readAnchorFile,
  trialFileExists,
  writeAnchorFile,
  hasValidTrialUnlock,
  trialState,
  pickEarliest,
  reconcileWithDb,
};
