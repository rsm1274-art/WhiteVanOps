// Preload for the client-setup window. Same nodeIntegration:false /
// contextIsolation:true shape as every other window, so this bridge exposes
// only the narrow calls the setup UI needs — mirrors activation-preload.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wvoClientSetup', {
  verify: (host, port) => ipcRenderer.send('verify-host', { host, port }),
  onResult: (callback) =>
    ipcRenderer.on('host-result', (_event, result) => callback(result)),
});
