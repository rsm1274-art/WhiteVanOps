const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const net = require('net');
const fs = require('fs');
const crypto = require('crypto');
const { ensurePostgres } = require('./postgres');
const { startBackupScheduler } = require('./backup');
const { machineIdSync } = require('node-machine-id');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, updateDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyBKde3dhM8NPrtw9DmRiXKayN0-7Qp05mw",
  authDomain: "white-van-ops-licensing.firebaseapp.com",
  projectId: "white-van-ops-licensing",
  storageBucket: "white-van-ops-licensing.firebasestorage.app",
  messagingSenderId: "908750609547",
  appId: "1:908750609547:web:cc4dc84e9f6b6dab68488e"
};
const firebaseApp = initializeApp(firebaseConfig);
const firestore = getFirestore(firebaseApp);

const isDev = !app.isPackaged;

// Packaged builds get their own Chromium profile under the app-managed
// per-OS app-data \whitevanops dir (app.getPath('appData')). Without this,
// dev and packaged runs share the default profile derived from package.json
// "name", and stale dev state — service worker registrations, localhost:3000
// cookies — leaks into packaged-install testing (2026-07-10: a zombie
// cache-first sw.js served a cached dashboard into a fresh install). Must run
// before app ready.
if (!isDev) {
  app.setPath('userData', path.join(app.getPath('appData'), 'whitevanops', 'profile'));
}
// In dev, electron-dev.js starts next dev and passes the port via env var.
// In production, the standalone server prefers 3000 but falls back to the
// next free port when a foreign app (e.g. a Docker container publishing
// 3000) already holds it — see startServer(). Mutable for that reason only.
let PORT = isDev ? (parseInt(process.env.ELECTRON_DEV_PORT, 10) || 3000) : 3000;

let mainWindow;
let loadingWindow;
let serverProcess;
let postgres = { managed: false };

function waitForServer(retries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = http.get(`http://localhost:${PORT}`, () => resolve());
      req.on('error', () => {
        if (n > 0) setTimeout(() => attempt(n - 1), 500);
        else reject(new Error('Application server failed to start within the timeout period.'));
      });
      req.setTimeout(500, () => req.destroy());
    };
    attempt(retries);
  });
}

// True only when the listener on `port` is actually a WhiteVanOps server —
// identified by GET /api/health returning { app: "whitevanops" }. A bare
// "something answered" check is not enough: any other product publishing the
// same port (2026-07-14: an Open WebUI Docker container on 3000) would be
// mistaken for our PM2 server and loaded straight into the app window.
function isWvoServer(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(false);
        return;
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).app === 'whitevanops');
        } catch {
          resolve(false);
        }
      });
      res.on('error', () => resolve(false));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

const PORT_SCAN_LIMIT = 100;

async function findFreePort(start) {
  for (let port = start; port < start + PORT_SCAN_LIMIT; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found between ${start} and ${start + PORT_SCAN_LIMIT - 1}.`);
}

async function startServer() {
  if (isDev) {
    // electron-dev.js already started next dev — nothing to do here.
    return;
  }

  // If a WhiteVanOps server is already serving this port (e.g. the always-on
  // PM2 field-tech service `whitevanops`), reuse it — two servers cannot bind
  // the same port, and booting a second one here just stalls startup. The
  // /api/health identity check keeps us from adopting a foreign app that
  // happens to hold 3000; in that case, fall back to the next free port.
  if (await isWvoServer(PORT)) {
    return;
  }
  if (!(await isPortFree(PORT))) {
    PORT = await findFreePort(PORT + 1);
    console.warn(`[startup] Port 3000 is held by another application; using port ${PORT} instead.`);
  }

  // Start (and on first run, initialize) the bundled PostgreSQL server.
  // No-op when the DB port already has a listener or DATABASE_URL is remote.
  postgres = await ensurePostgres({
    resourcesPath: process.resourcesPath,
    appDataWvoDir: path.join(app.getPath('appData'), 'whitevanops'),
  });

  // Production: require the standalone server inline (Electron's main process IS Node.js).
  const serverPath = path.join(process.resourcesPath, 'nextjs', 'server.js');
  process.env.PORT = String(PORT);
  // Bind every interface, not `localhost`. The standalone server passes this
  // straight to `server.listen(port, hostname)`, and on Windows Node resolves
  // "localhost" to ::1 first — so the old value bound IPv6 loopback ONLY
  // (`netstat` showed a lone `[::1]:3000`). The dashboard still worked because
  // it dials itself; every phone on the office WiFi got a dropped SYN and a
  // white screen that never finished loading, whichever address the Field
  // Access QR offered. That breaks Base's entire transport — LAN field sync —
  // so this must stay a wildcard bind. Loopback callers are unaffected: Node
  // (autoSelectFamily, on by default since Node 20) and Chromium both fall back
  // to 127.0.0.1, so `http://localhost:${PORT}` elsewhere in this file still
  // connects. `0.0.0.0` is also what the standalone server defaults to when
  // HOSTNAME is unset, so this restores Next's own intended behaviour.
  process.env.HOSTNAME = '0.0.0.0';
  require(serverPath);

  startBackupScheduler(PORT, isDev, process.resourcesPath);
}

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 400,
    height: 320,
    frame: false,
    resizable: false,
    center: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  loadingWindow.loadFile(path.join(__dirname, 'loading.html'));
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'WhiteVanOps',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(`http://localhost:${PORT}`);

  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.close();
    loadingWindow = null;
  }

  mainWindow.show();
  mainWindow.focus();

  mainWindow.on('closed', () => { mainWindow = null; });
}

function getLicensePath() {
  const appDataPath = app.getPath('appData');
  const wvoPath = path.join(appDataPath, 'whitevanops');
  if (!fs.existsSync(wvoPath)) fs.mkdirSync(wvoPath, { recursive: true });
  return path.join(wvoPath, 'license.json');
}

// The local license file is HMAC-signed so it cannot be forged by hand-editing
// license.json. The signature binds the key to this machine's hardware id, and
// the secret below is baked into the build — an attacker would have to unpack
// the app and extract it rather than just craft a plain JSON file. This is not
// unbreakable DRM, but it raises the bar from "trivial" to "meaningful".
const LICENSE_SIGNING_SECRET = 'wvo.lic.v1.6b2f9d4c8a1e7035f2c9b0d4e6a8135790acdef1234567890fedcba098765';

// The tier is part of the signed payload, so an activated install's plan is
// bound to its key and machine and cannot be edited on disk. These two
// functions MUST stay byte-identical to signBaseLicense/signLegacyBaseLicense
// in src/lib/licenseCrypto.ts — main.js runs before the Next.js bundle loads
// and cannot import TypeScript, so the duplication is deliberate. If the
// formats drift, activation writes a file the running app then rejects.
function signLicense(key, machineId, tier) {
  return crypto
    .createHmac('sha256', LICENSE_SIGNING_SECRET)
    .update(`${key}:${machineId}:${tier}`)
    .digest('hex');
}

// Pre-tier format, kept so installs activated before tiered licenses keep
// launching without re-activation. Such installs read back as tier "base".
function signLegacyLicense(key, machineId) {
  return crypto
    .createHmac('sha256', LICENSE_SIGNING_SECRET)
    .update(`${key}:${machineId}`)
    .digest('hex');
}

function writeLicense(key, machineId, tier) {
  const sig = signLicense(key, machineId, tier);
  fs.writeFileSync(getLicensePath(), JSON.stringify({ key, machineId, tier, sig }));
}

async function verifyLicenseSilent() {
  const licensePath = getLicensePath();
  if (!fs.existsSync(licensePath)) return false;

  try {
    const data = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
    if (!data.key || !data.machineId || !data.sig) return false;

    const hwid = machineIdSync();
    if (data.machineId !== hwid) return false;

    // Reject any file whose signature doesn't match — i.e. hand-crafted ones,
    // including one whose tier was edited after activation.
    const isTiered = typeof data.tier === 'string';
    const tier = data.tier === 'plus' ? 'plus' : 'base';
    const expected = isTiered
      ? signLicense(data.key, data.machineId, tier)
      : signLegacyLicense(data.key, data.machineId);
    const actual = Buffer.from(String(data.sig));
    const expectedBuf = Buffer.from(expected);
    if (actual.length !== expectedBuf.length) return false;
    if (!crypto.timingSafeEqual(actual, expectedBuf)) return false;

    return true;
  } catch (e) {
    return false;
  }
}

// True when this packaged build was produced by `npm run electron:build:trial`.
// scripts/electron-build.js writes WVO_IS_TRIAL="true" into
// resources/nextjs/.env.local for trial builds. Read that file directly here:
// this check runs before startServer() requires the standalone Next.js
// server (which is what normally loads .env.local), and dev builds never
// reach this function's caller because isDev already short-circuits.
function isTrialBuild() {
  try {
    const envPath = path.join(process.resourcesPath, 'nextjs', '.env.local');
    if (!fs.existsSync(envPath)) return false;
    return /^\s*WVO_IS_TRIAL\s*=\s*"?true"?\s*$/m.test(fs.readFileSync(envPath, 'utf8'));
  } catch {
    return false;
  }
}

function showActivationWindow() {
  return new Promise((resolve) => {
    const activationWindow = new BrowserWindow({
      width: 500,
      height: 400,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'activation-preload.js'),
      },
      resizable: false,
      center: true
    });

    activationWindow.loadFile(path.join(__dirname, 'activation.html'));

    let activated = false;

    // Registered with `on` (not `once`) so a mistyped key can be corrected and
    // retried; the listener is removed on success and on window close.
    const handler = async (event, key) => {
      try {
        const docRef = doc(firestore, 'licenses', key);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
          event.reply('license-result', { success: false, error: 'Invalid license key.' });
          return;
        }

        const data = docSnap.data();
        if (!data.active) {
          event.reply('license-result', { success: false, error: 'License key is inactive.' });
          return;
        }

        const hwid = machineIdSync();

        if (data.machineId && data.machineId !== hwid) {
          event.reply('license-result', { success: false, error: 'License key is already tied to another machine.' });
          return;
        }

        if (!data.machineId) {
          await updateDoc(docRef, { machineId: hwid });
        }

        // The tier travels with the key: scripts/license-manager.js stamps it
        // onto the Firestore record at mint time (`--tier base|plus`), and it
        // is baked into the signed local license here. Keys minted before the
        // tier field existed have no `tier` and correctly resolve to base.
        const tier = data.tier === 'plus' ? 'plus' : 'base';
        writeLicense(key, hwid, tier);
        activated = true;

        event.reply('license-result', { success: true });

        setTimeout(() => {
          ipcMain.removeListener('verify-license', handler);
          if (!activationWindow.isDestroyed()) activationWindow.close();
          resolve();
        }, 1500);
      } catch (err) {
        event.reply('license-result', { success: false, error: err.message });
      }
    };

    ipcMain.on('verify-license', handler);

    activationWindow.on('closed', () => {
      ipcMain.removeListener('verify-license', handler);
      if (!activated && !fs.existsSync(getLicensePath())) {
        app.quit();
      }
    });
  });
}

app.whenReady().then(async () => {
  createLoadingWindow();

  try {
    const isActivated = isTrialBuild() ? true : await verifyLicenseSilent();
    if (!isActivated) {
      if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
      await showActivationWindow();
      createLoadingWindow();
    }

    await startServer();
    await waitForServer();
    await createMainWindow();
  } catch (err) {
    console.error('[startup] Fatal:', err);
    if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
    dialog.showErrorBox('WhiteVanOps — Startup Error', err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // macOS apps conventionally stay running (in the Dock) with no windows
  // open; `activate` below rebuilds the window when the Dock icon is clicked.
  if (process.platform === 'darwin') return;
  if (serverProcess) serverProcess.kill();
  app.quit();
});

app.on('will-quit', () => {
  if (postgres.managed) postgres.stop();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
