import { contextBridge, ipcRenderer } from "electron";

// Expose a minimal, secure API to the renderer process.
// Currently just platform info and version — extend as needed.
contextBridge.exposeInMainWorld("cortexDesktop", {
  platform: process.platform,
  isElectron: true,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
});
