const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
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
// In dev, electron-dev.js starts next dev and passes the port via env var.
// In production, the standalone server always uses 3000.
const PORT = isDev ? (parseInt(process.env.ELECTRON_DEV_PORT, 10) || 3000) : 3000;

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

function isServerUp() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}`, () => resolve(true));
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => { req.destroy(); resolve(false); });
  });
}

async function startServer() {
  if (isDev) {
    // electron-dev.js already started next dev — nothing to do here.
    return;
  }

  // If a server is already serving this port (e.g. the always-on PM2
  // field-tech service `whitevanops`), reuse it — two servers cannot bind the
  // same port, and booting a second one here just stalls startup. Only spin up
  // our own inline standalone server when nothing is already answering.
  if (await isServerUp()) {
    return;
  }

  // Start (and on first run, initialize) the bundled PostgreSQL server.
  // No-op when the DB port already has a listener or DATABASE_URL is remote.
  postgres = await ensurePostgres({ resourcesPath: process.resourcesPath });

  // Production: require the standalone server inline (Electron's main process IS Node.js).
  const serverPath = path.join(process.resourcesPath, 'nextjs', 'server.js');
  process.env.PORT = String(PORT);
  process.env.HOSTNAME = 'localhost';
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

function signLicense(key, machineId) {
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
    const expected = signLicense(data.key, data.machineId);
    const actual = Buffer.from(String(data.sig));
    const expectedBuf = Buffer.from(expected);
    if (actual.length !== expectedBuf.length) return false;
    if (!crypto.timingSafeEqual(actual, expectedBuf)) return false;

    return true;
  } catch (e) {
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

        writeLicense(key, hwid);
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
    const isActivated = await verifyLicenseSilent();
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
  if (serverProcess) serverProcess.kill();
  app.quit();
});

app.on('will-quit', () => {
  if (postgres.managed) postgres.stop();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
