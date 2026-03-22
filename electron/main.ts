import { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog } from "electron";
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

// ============ Start Express Server ============
async function startServer(port: number): Promise<void> {
  // Set env vars before importing the server
  process.env.NODE_ENV = "production";
  process.env.PORT = String(port);
  process.env.CORTEX_DATA_DIR = getDataDir();
  process.env.ELECTRON = "1";

  // The built server bundle is at dist/index.cjs
  // __dirname in dev = dist/electron/, so ../index.cjs reaches dist/index.cjs
  // In packaged app, it's copied to resources/server/index.cjs via extraResources
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, "server", "index.cjs")
    : path.join(__dirname, "..", "index.cjs");

  // Import the server — it self-starts via its IIFE
  return new Promise((resolve, reject) => {
    try {
      console.log(`[Cortex] Loading server from: ${serverPath}`);
      require(serverPath);
      console.log("[Cortex] Server module loaded, waiting for port...");

      // Poll until the server is accepting connections
      let attempts = 0;
      const maxAttempts = 300; // 30 seconds at 100ms intervals
      const check = setInterval(() => {
        attempts++;
        const testConn = net.createConnection({ port, host: "127.0.0.1" }, () => {
          testConn.end();
          clearInterval(check);
          resolve();
        });
        testConn.on("error", () => {
          // Not ready yet, keep checking
          if (attempts >= maxAttempts) {
            clearInterval(check);
            reject(new Error("Server did not start within 30 seconds"));
          }
        });
      }, 100);
    } catch (err) {
      console.error("[Cortex] Failed to load server module:", err);
      reject(err);
    }
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
  const iconPath = path.join(__dirname, "..", "electron", "icons", "icon.png");
  // Fallback if icon doesn't exist yet
  return iconPath;
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
});
