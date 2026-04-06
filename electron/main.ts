import { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain, utilityProcess } from "electron";
import path from "path";
import { createServer } from "http";
import net from "net";

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverPort: number = 0;
let httpServer: ReturnType<typeof createServer> | null = null;

// ============ Data Directory ============
// In Electron, use userData path by default (portable, per-user).
// Can be overridden with CORTEX_DATA_DIR env var.
function getDataDir(): string {
  if (process.env.CORTEX_DATA_DIR) {
    return process.env.CORTEX_DATA_DIR;
  }
  return path.join(app.getPath("userData"), ".cortex-data");
}

// ============ Find Available Port ============
function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr !== "string") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("Could not find available port"));
      }
    });
    srv.on("error", reject);
  });
}

let serverProcess: Electron.UtilityProcess | null = null;

// ============ Start Express Server ============
async function startServer(port: number): Promise<void> {
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, "server", "index.cjs")
    : path.join(__dirname, "..", "index.cjs");

  console.log(`[Cortex] Forking server from: ${serverPath}`);

  // Fork the server as a UtilityProcess — runs in a separate Node.js process
  // with its own event loop, so sync I/O and CPU work never block the UI.
  serverProcess = utilityProcess.fork(serverPath, [], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      CORTEX_DATA_DIR: getDataDir(),
      ELECTRON: "1",
    },
    stdio: "pipe",
  });

  serverProcess.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[server] ${chunk}`);
  });
  serverProcess.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[server] ${chunk}`);
  });
  serverProcess.on("exit", (code) => {
    console.error(`[Cortex] Server process exited with code ${code}`);
    serverProcess = null;
  });

  // Poll until the server is accepting connections
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 300; // 30 s at 100 ms intervals
    const check = setInterval(() => {
      attempts++;
      const testConn = net.createConnection({ port, host: "127.0.0.1" }, () => {
        testConn.end();
        clearInterval(check);
        console.log(`[Cortex] Server ready at http://127.0.0.1:${port}`);
        resolve();
      });
      testConn.on("error", () => {
        if (attempts >= maxAttempts) {
          clearInterval(check);
          reject(new Error("Server did not start within 30 seconds"));
        }
      });
    }, 100);
  });
}

// ============ Create Window ============
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Cortex",
    icon: getIconPath(),
    backgroundColor: "#0e1117",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  // Show window when ready to avoid white flash
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("close", (event) => {
    // On macOS, hide to tray instead of quitting
    if (process.platform === "darwin" && tray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ============ System Tray ============
function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icons", "icon.png");
  }
  // In dev and npx: icons are in dist/icons/ (copied there by the build script)
  // __dirname is dist/electron/, so ../icons/ reaches dist/icons/
  return path.join(__dirname, "..", "icons", "icon.png");
}

function createTray() {
  const iconPath = getIconPath();
  let trayIcon: Electron.NativeImage;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      // Create a simple 16x16 teal icon as fallback
      trayIcon = nativeImage.createEmpty();
    }
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  // Resize for tray (16x16 on most platforms)
  if (!trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("Cortex");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Cortex",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: "separator" },
    {
      label: `Data: ${getDataDir()}`,
      enabled: false,
    },
    {
      label: "Open Data Folder",
      click: () => {
        shell.openPath(getDataDir());
      },
    },
    { type: "separator" },
    {
      label: "Quit Cortex",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ============ App Menu (macOS) ============
function setupMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Open Data Folder",
          click: () => shell.openPath(getDataDir()),
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ============ App Lifecycle ============
app.on("ready", async () => {
  // IPC: Open a folder in the native file manager
  ipcMain.handle("open-folder", async (_event, folderPath: string) => {
    if (folderPath && typeof folderPath === "string") {
      return shell.openPath(folderPath);
    }
    return "Invalid path";
  });

  // IPC: Show native folder picker dialog
  ipcMain.handle("pick-folder", async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Select Vault Folder",
      buttonLabel: "Select Folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  try {
    serverPort = await findAvailablePort();
    console.log(`[Cortex] Starting server on port ${serverPort}...`);
    console.log(`[Cortex] Data directory: ${getDataDir()}`);

    await startServer(serverPort);
    console.log(`[Cortex] Server ready at http://127.0.0.1:${serverPort}`);

    setupMenu();
    createTray();
    createWindow();
  } catch (err) {
    console.error("[Cortex] Failed to start:", err);
    dialog.showErrorBox(
      "Cortex failed to start",
      `Error: ${err instanceof Error ? err.message : String(err)}\n\nPlease check your configuration and try again.`
    );
    app.quit();
  }
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  // On macOS, keep running in tray
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On macOS, re-create window when dock icon clicked
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on("before-quit", () => {
  // Force close on macOS quit (bypass hide-to-tray behavior)
  if (mainWindow) {
    mainWindow.removeAllListeners("close");
    mainWindow.close();
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
  // Terminate the server utility process
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
