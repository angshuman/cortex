import { contextBridge, ipcRenderer } from "electron";

// Expose a minimal, secure API to the renderer process.
contextBridge.exposeInMainWorld("cortexDesktop", {
  platform: process.platform,
  isElectron: true,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  /** Open a folder in the native file manager (Explorer / Finder) */
  openFolder: (folderPath: string) => ipcRenderer.invoke("open-folder", folderPath),
});
