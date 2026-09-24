const { app, BrowserWindow, shell, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const http = require('http');
const net = require('net');
const fs = require('fs');
const crypto = require('crypto');
const { ensurePostgres } = require('./postgres');
const { startBackupScheduler } = require('./backup');
const trial = require('./trial');
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

// Waits for a locally-started server to come up. Not used in client mode —
// there, app.whenReady() has already confirmed the remote host answers
// before startServer() (a no-op there) even runs.
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

// True only when the listener on `host`:`port` is actually a WhiteVanOps
// server — identified by GET /api/health returning { app: "whitevanops" }. A
// bare "something answered" check is not enough: any other product publishing
// the same port (2026-07-14: an Open WebUI Docker container on 3000) would be
// mistaken for our PM2 server and loaded straight into the app window. `host`
// defaults to localhost for the existing same-machine reuse check; client
// mode passes a remote host to probe the configured office server instead.
function isWvoServer(host, port) {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/api/health`, (res) => {
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

  // Client mode: this machine is not the host. Never boot a local database or
  // server here — that is exactly how you end up with two divergent copies of
  // the data, which shared-database mode exists to avoid. app.whenReady()
  // already confirmed the host answers before we get this far, so there is
  // nothing left for startServer() to do.
  const hostConfig = readHostConfig();
  if (hostConfig.mode === 'client') {
    return;
  }

  // If a WhiteVanOps server is already serving this port (e.g. the always-on
  // PM2 field-tech service `whitevanops`), reuse it — two servers cannot bind
  // the same port, and booting a second one here just stalls startup. The
  // /api/health identity check keeps us from adopting a foreign app that
  // happens to hold 3000; in that case, fall back to the next free port.
  if (await isWvoServer('localhost', PORT)) {
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

  await mainWindow.loadURL(`http://${connectionTarget.host}:${connectionTarget.port}`);

  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.close();
    loadingWindow = null;
  }

  mainWindow.show();
  mainWindow.focus();

  mainWindow.on('closed', () => { mainWindow = null; });
}

function getWvoDir() {
  const wvoPath = path.join(app.getPath('appData'), 'whitevanops');
  if (!fs.existsSync(wvoPath)) fs.mkdirSync(wvoPath, { recursive: true });
  return wvoPath;
}

function getLicensePath() {
  return path.join(getWvoDir(), 'license.json');
}

// Shared-database ("client mode") config. Absence of this file — the state of
// every install that predates this feature — means "host": run the database
// and server on this machine exactly as before. Only a machine an operator
// has explicitly pointed at another office server carries
// { mode: "client", host, port }. Never inferred, never defaulted to client.
function getHostConfigPath() {
  const appDataPath = app.getPath('appData');
  const wvoPath = path.join(appDataPath, 'whitevanops');
  if (!fs.existsSync(wvoPath)) fs.mkdirSync(wvoPath, { recursive: true });
  return path.join(wvoPath, 'host.json');
}

function readHostConfig() {
  try {
    const raw = fs.readFileSync(getHostConfigPath(), 'utf8');
    const data = JSON.parse(raw);
    if (data.mode === 'client' && typeof data.host === 'string' && Number.isInteger(data.port)) {
      return data;
    }
  } catch {
    // Missing or malformed file — fall through to host mode below.
  }
  return { mode: 'host' };
}

function writeHostConfig(config) {
  fs.writeFileSync(getHostConfigPath(), JSON.stringify(config));
}

// Set once at startup to whichever address createMainWindow() should load —
// localhost:PORT for a host machine, or the configured remote office server
// for a client. Read by both createMainWindow() and the `activate` handler
// (Dock icon re-click on macOS), which re-enters window creation on a
// separate path and must resolve to the same target rather than re-prompting.
let connectionTarget = { host: 'localhost', port: PORT };

// The local license file is HMAC-signed so it cannot be forged by hand-editing
// license.json. The signature binds the key to this machine's hardware id, and
// the secret below is baked into the build — an attacker would have to unpack
// the app and extract it rather than just craft a plain JSON file. This is not
// unbreakable DRM, but it raises the bar from "trivial" to "meaningful".
const LICENSE_SIGNING_SECRET = 'wvo.lic.v1.6b2f9d4c8a1e7035f2c9b0d4e6a8135790acdef1234567890fedcba098765';

// v2.0: there is no tier concept any more — a signed license.json only
// proves "this key is activated on this machine". These two functions MUST
// stay byte-identical to signBaseLicense/signLegacyBaseLicense in
// src/lib/licenseCrypto.ts — main.js runs before the Next.js bundle loads
// and cannot import TypeScript, so the duplication is deliberate. If the
// formats drift, activation writes a file the running app then rejects.
function signLicense(key, machineId) {
  return crypto
    .createHmac('sha256', LICENSE_SIGNING_SECRET)
    .update(`${key}:${machineId}`)
    .digest('hex');
}

// Pre-v2.0 ("legacy") format. Now functionally identical to signLicense
// above — kept as a separate name only so "legacy" stays a truthful
// historical marker alongside src/lib/licenseCrypto.ts.
function signLegacyLicense(key, machineId) {
  return crypto
    .createHmac('sha256', LICENSE_SIGNING_SECRET)
    .update(`${key}:${machineId}`)
    .digest('hex');
}

function writeLicense(key, machineId) {
  const sig = signLicense(key, machineId);
  fs.writeFileSync(getLicensePath(), JSON.stringify({ key, machineId, sig }));
}

async function verifyLicenseSilent() {
  const licensePath = getLicensePath();
  if (!fs.existsSync(licensePath)) return false;

  try {
    const data = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
    if (!data.key || !data.machineId || !data.sig) return false;

    const hwid = machineIdSync();
    if (data.machineId !== hwid) return false;

    // Reject any file whose signature doesn't match — i.e. hand-crafted ones.
    const expectedCurrent = signLicense(data.key, data.machineId);
    const expectedLegacy = signLegacyLicense(data.key, data.machineId);
    const actual = Buffer.from(String(data.sig));
    const matches = (expectedBuf) => {
      const buf = Buffer.from(expectedBuf);
      return actual.length === buf.length && crypto.timingSafeEqual(actual, buf);
    };
    if (!matches(expectedCurrent) && !matches(expectedLegacy)) return false;

    return true;
  } catch (e) {
    return false;
  }
}

// One installer: whether this machine may run is decided at launch, not at
// build time. Returns
//   { kind: 'licensed' }                          — license.json or the offline trial-unlock
//   { kind: 'trial', expired, daysRemaining }     — a 30-day trial was started here
//   { kind: 'none' }                              — first launch: ask (key / trial / client)
// A trial.json that exists but fails verification (hand-edited, copied from
// another machine) counts as an expired trial — fail closed, like the server.
async function getAccess() {
  if (await verifyLicenseSilent()) return { kind: 'licensed' };
  const hwid = machineIdSync();
  const dir = getWvoDir();
  if (trial.hasValidTrialUnlock(LICENSE_SIGNING_SECRET, dir, hwid)) return { kind: 'licensed' };
  const anchor = trial.readAnchorFile(LICENSE_SIGNING_SECRET, dir, hwid);
  if (anchor) return { kind: 'trial', ...trial.trialState(anchor.installedAt) };
  if (trial.trialFileExists(dir)) return { kind: 'trial', expired: true, daysRemaining: 0 };
  return { kind: 'none' };
}

// Mirrors the trial start date into the database so deleting trial.json alone
// can't restart the clock (see electron/trial.js). Runs once the database is
// up. A sync failure never blocks startup — the file-based state stands.
async function reconcileTrialWithDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const { Client } = require('pg');
  const connUrl = new URL(url);
  connUrl.searchParams.delete('schema'); // Prisma-only param; libpq rejects it
  const client = new Client({ connectionString: connUrl.toString() });
  try {
    await client.connect();
    return await trial.reconcileWithDb({
      client, secret: LICENSE_SIGNING_SECRET, dir: getWvoDir(), machineId: machineIdSync(),
    });
  } catch (err) {
    console.error('[trial] Could not sync the trial start date with the database:', err.message);
    return null;
  } finally {
    try { await client.end(); } catch { /* never connected */ }
  }
}

// While a trial is running, re-check hourly so an office PC left open past
// day 30 still hits the activation screen (the server-side lock covers
// phones and new logins).
let trialTimer = null;
function watchTrialExpiry() {
  if (trialTimer) return;
  trialTimer = setInterval(async () => {
    const access = await getAccess();
    if (access.kind !== 'trial') {
      clearInterval(trialTimer);
      trialTimer = null;
      return;
    }
    if (!access.expired) return;
    clearInterval(trialTimer);
    trialTimer = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    await showActivationWindow('expired'); // quits the app if closed without a key
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
      mainWindow.show();
    }
  }, 60 * 60 * 1000);
}

// Help → "Enter activation key…": convert a running trial early.
async function promptActivationFromMenu() {
  const access = await getAccess();
  if (access.kind === 'licensed') {
    dialog.showMessageBox({ type: 'info', message: 'This installation is already activated.' });
    return;
  }
  const result = await showActivationWindow('activate');
  if (result.mode === 'host' && mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'Enter activation key…', click: () => { promptActivationFromMenu(); } }],
    },
  ]));
}

// `mode` decides what the window offers:
//   'first'    — first launch: activation key, "Start 30-day trial", or
//                "connect to an existing office server" (client mode).
//   'expired'  — the trial has ended: activation key only. Closing quits.
//   'activate' — Help menu, during a trial: activation key only. Closing
//                just closes (resolves { mode: 'cancelled' }).
// Resolves { mode: 'host' } once activated or a trial is started, or
// { mode: 'client', host, port } from the client-setup hand-off. Never shown
// on an already-activated machine, which is what keeps every existing install
// unaffected by client mode and by the trial.
function showActivationWindow(mode = 'first') {
  return new Promise((resolve) => {
    const activationWindow = new BrowserWindow({
      width: 500,
      height: mode === 'first' ? 600 : 440,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'activation-preload.js'),
      },
      resizable: false,
      center: true
    });

    activationWindow.loadFile(path.join(__dirname, 'activation.html'), { query: { mode } });

    let settled = false;

    // Registered with `on` (not `once`) so a mistyped key can be corrected and
    // retried; the listener is removed on success and on window close.
    const licenseHandler = async (event, key) => {
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

        writeLicense(key, hwid);
        settled = true;

        event.reply('license-result', { success: true });

        setTimeout(() => {
          removeListeners();
          if (!activationWindow.isDestroyed()) activationWindow.close();
          resolve({ mode: 'host' });
        }, 1500);
      } catch (err) {
        event.reply('license-result', { success: false, error: err.message });
      }
    };

    // The operator has an existing office server already and wants this
    // machine to be a client instead of activating its own license.
    const switchHandler = async () => {
      if (mode !== 'first') return;
      settled = true;
      removeListeners();
      if (!activationWindow.isDestroyed()) activationWindow.close();
      const target = await showClientSetupWindow();
      resolve({ mode: 'client', ...target });
    };

    // "Start 30-day trial" — first launch only. Writes the signed trial.json;
    // the database copy is added once Postgres is up (reconcileTrialWithDb),
    // and an older date already in the database wins over this one.
    const trialHandler = () => {
      if (mode !== 'first') return;
      const hwid = machineIdSync();
      const dir = getWvoDir();
      if (!trial.readAnchorFile(LICENSE_SIGNING_SECRET, dir, hwid)) {
        trial.writeAnchorFile(LICENSE_SIGNING_SECRET, dir, new Date().toISOString(), hwid);
      }
      settled = true;
      removeListeners();
      if (!activationWindow.isDestroyed()) activationWindow.close();
      resolve({ mode: 'host', trial: true });
    };

    const removeListeners = () => {
      ipcMain.removeListener('verify-license', licenseHandler);
      ipcMain.removeListener('switch-to-client-setup', switchHandler);
      ipcMain.removeListener('start-trial', trialHandler);
    };

    ipcMain.on('verify-license', licenseHandler);
    ipcMain.on('switch-to-client-setup', switchHandler);
    ipcMain.on('start-trial', trialHandler);

    activationWindow.on('closed', () => {
      removeListeners();
      if (settled) return;
      if (mode === 'activate') {
        resolve({ mode: 'cancelled' });
      } else {
        app.quit();
      }
    });
  });
}

// Small window (modeled on showActivationWindow above — same
// ipcMain.on/event.reply pattern, no ipcMain.handle) that takes a host[:port]
// for an existing WhiteVanOps office server, verifies it before accepting,
// and writes host.json. Resolves with { host, port } on success. Used both
// from the first-run activation window and from handleUnreachableHost()
// below when a saved host stops answering and the operator reconfigures.
function showClientSetupWindow() {
  return new Promise((resolve) => {
    const setupWindow = new BrowserWindow({
      width: 480,
      height: 380,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'client-setup-preload.js'),
      },
      resizable: false,
      center: true,
    });

    setupWindow.loadFile(path.join(__dirname, 'client-setup.html'));

    let connected = false;

    const handler = async (event, { host, port }) => {
      try {
        const reachable = await isWvoServer(host, port);
        if (!reachable) {
          event.reply('host-result', {
            success: false,
            error: `No WhiteVanOps server found at ${host}:${port}. Check the address and that computer's power and network connection.`,
          });
          return;
        }

        writeHostConfig({ mode: 'client', host, port });
        connected = true;

        event.reply('host-result', { success: true });

        setTimeout(() => {
          ipcMain.removeListener('verify-host', handler);
          if (!setupWindow.isDestroyed()) setupWindow.close();
          resolve({ host, port });
        }, 1000);
      } catch (err) {
        event.reply('host-result', { success: false, error: err.message });
      }
    };

    ipcMain.on('verify-host', handler);

    setupWindow.on('closed', () => {
      ipcMain.removeListener('verify-host', handler);
      if (!connected) {
        app.quit();
      }
    });
  });
}

// A saved client-mode host that doesn't answer at startup. Never falls back
// to booting a local database — that is the exact divergent-copy failure
// mode shared-database mode exists to avoid. Loops on Retry; Reconfigure
// re-opens the setup window (which re-verifies before writing); Quit exits.
// Returns the (now-reachable) host config, or null if the operator quit.
async function handleUnreachableHost(hostConfig) {
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'WhiteVanOps — Cannot Reach Office Server',
      message: `Cannot reach the office server at ${hostConfig.host}:${hostConfig.port}.`,
      detail: "Make sure that computer is turned on and connected to the same network, then try again.",
      buttons: ['Retry', 'Reconfigure', 'Quit'],
      defaultId: 0,
      cancelId: 2,
    });

    if (response === 2) {
      app.quit();
      return null;
    }

    if (response === 1) {
      const target = await showClientSetupWindow();
      return { mode: 'client', ...target };
    }

    if (await isWvoServer(hostConfig.host, hostConfig.port)) {
      return hostConfig;
    }
  }
}

app.whenReady().then(async () => {
  createLoadingWindow();

  try {
    let hostConfig = readHostConfig();

    buildAppMenu();

    let access = null;
    if (hostConfig.mode === 'host') {
      access = await getAccess();
      if (access.kind === 'none' || (access.kind === 'trial' && access.expired)) {
        if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
        const choice = await showActivationWindow(access.kind === 'none' ? 'first' : 'expired');
        createLoadingWindow();
        if (choice.mode === 'client') {
          hostConfig = choice;
        }
        access = await getAccess();
      }
    }

    if (hostConfig.mode === 'client') {
      const reachable = await isWvoServer(hostConfig.host, hostConfig.port);
      if (!reachable) {
        if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
        hostConfig = await handleUnreachableHost(hostConfig);
        if (!hostConfig) return; // operator chose Quit; app.quit() already called
        createLoadingWindow();
      }
      connectionTarget = { host: hostConfig.host, port: hostConfig.port };
    } else {
      await startServer();
      connectionTarget = { host: 'localhost', port: PORT };
      await waitForServer();

      // The database is up: sync the trial start date with its copy there.
      // An older date in the database (trial.json deleted and a "new" trial
      // started) wins, which can mean the trial has in fact already ended.
      if (access && access.kind === 'trial') {
        const anchor = await reconcileTrialWithDb();
        if (anchor && trial.trialState(anchor.installedAt).expired) {
          if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
          await showActivationWindow('expired');
          createLoadingWindow();
        }
        watchTrialExpiry();
      }
    }

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
