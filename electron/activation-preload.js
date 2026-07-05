// Preload for the license-activation window. The window runs with
// nodeIntegration:false / contextIsolation:true (matching every other window),
// so the renderer has no direct access to Node or ipcRenderer. This bridge
// exposes only the two narrow calls the activation UI needs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wvoActivation', {
  verify: (key) => ipcRenderer.send('verify-license', key),
  onResult: (callback) =>
    ipcRenderer.on('license-result', (_event, result) => callback(result)),
});
