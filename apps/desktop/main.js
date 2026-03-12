const { BrowserWindow, app, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const { executeRequestLocally } = require("@devhttp/local-executor");

if (process.platform === "linux") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
}

const WORKSPACE_SNAPSHOT_FILE = "workspace-snapshots.json";
const TITLE_BAR_HEIGHT = 36;
const TITLE_BAR_THEME = {
  dark: {
    color: "#09111e",
    symbolColor: "#f8fafc",
  },
  light: {
    color: "#edf4ff",
    symbolColor: "#15253b",
  },
};

let titleBarDragState = null;

function getTargetUrl() {
  const desktopClientSuffix = "client=desktop";

  if (process.env.DEVHTTP_DESKTOP_URL) {
    return appendDesktopClientMarker(process.env.DEVHTTP_DESKTOP_URL, desktopClientSuffix);
  }

  if (app.isPackaged) {
    return `https://devhttp.marcelocorrea.com.br?${desktopClientSuffix}`;
  }

  return `http://localhost:3000?${desktopClientSuffix}`;
}

function appendDesktopClientMarker(url, marker) {
  const parsed = new URL(url);
  if (!parsed.searchParams.has("client")) {
    parsed.searchParams.set("client", "desktop");
  }
  return parsed.toString();
}

let mainWindow = null;

function createWindow() {
  const targetUrl = getTargetUrl();
  const allowedOrigin = new URL(targetUrl).origin;
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    backgroundColor: "#09111e",
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay:
      process.platform === "darwin"
        ? false
        : {
            ...TITLE_BAR_THEME.dark,
            height: TITLE_BAR_HEIGHT,
          },
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow = window;

  window.on("maximize", () => {
    titleBarDragState = null;
    window.webContents.send("devhttp:maximize-change", true);
  });
  window.on("unmaximize", () => window.webContents.send("devhttp:maximize-change", false));
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
    titleBarDragState = null;
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === allowedOrigin) {
      return { action: "allow" };
    }

    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === allowedOrigin) {
      return;
    }

    event.preventDefault();
    void shell.openExternal(url);
  });

  void window.loadURL(targetUrl);

  window.webContents.on("did-finish-load", () => {
    window.webContents.send("devhttp:maximize-change", window.isMaximized());
  });
}

function setTitleBarTheme(theme) {
  if (!mainWindow || mainWindow.isDestroyed() || process.platform === "darwin") {
    return false;
  }

  const resolvedTheme = theme === "light" ? "light" : "dark";
  mainWindow.setTitleBarOverlay({
    ...TITLE_BAR_THEME[resolvedTheme],
    height: TITLE_BAR_HEIGHT,
  });
  return true;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function beginTitleBarDrag(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    titleBarDragState = null;
    return false;
  }

  const screenX = Number(payload?.screenX);
  const screenY = Number(payload?.screenY);
  const clientX = Number(payload?.clientX);
  const clientY = Number(payload?.clientY);
  const viewportWidth = Number(payload?.viewportWidth);

  if (
    !Number.isFinite(screenX) ||
    !Number.isFinite(screenY) ||
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= 0
  ) {
    titleBarDragState = null;
    return false;
  }

  const isMaximized = mainWindow.isMaximized();
  const targetBounds = isMaximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  const widthRatio = clamp(clientX / viewportWidth, 0, 1);
  const offsetX = isMaximized ? Math.round(targetBounds.width * widthRatio) : Math.round(clientX);
  const offsetY = Math.round(clamp(clientY, 0, TITLE_BAR_HEIGHT));
  const nextX = Math.round(screenX - offsetX);
  const nextY = Math.round(screenY - offsetY);

  if (isMaximized) {
    mainWindow.unmaximize();
    mainWindow.setBounds(
      {
        x: nextX,
        y: nextY,
        width: targetBounds.width,
        height: targetBounds.height,
      },
      false,
    );
  }

  titleBarDragState = {
    offsetX,
    offsetY,
  };

  return true;
}

function updateTitleBarDrag(payload) {
  if (!mainWindow || mainWindow.isDestroyed() || !titleBarDragState) {
    return false;
  }

  const screenX = Number(payload?.screenX);
  const screenY = Number(payload?.screenY);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) {
    return false;
  }

  const nextX = Math.round(screenX - titleBarDragState.offsetX);
  const nextY = Math.round(screenY - titleBarDragState.offsetY);
  mainWindow.setPosition(nextX, nextY, false);
  return true;
}

function endTitleBarDrag() {
  titleBarDragState = null;
  return true;
}

function getWorkspaceSnapshotPath() {
  return path.join(app.getPath("userData"), WORKSPACE_SNAPSHOT_FILE);
}

function readWorkspaceSnapshots() {
  const filePath = getWorkspaceSnapshotPath();
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeWorkspaceSnapshots(store) {
  const filePath = getWorkspaceSnapshotPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
}

ipcMain.handle("devhttp:is-maximized", () => mainWindow?.isMaximized() ?? false);
ipcMain.handle("devhttp:window-minimize", () => mainWindow?.minimize());
ipcMain.handle("devhttp:window-maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle("devhttp:window-close", () => mainWindow?.close());
ipcMain.handle("devhttp:get-platform", () => process.platform);
ipcMain.handle("devhttp:window-begin-titlebar-drag", (_event, payload) => {
  return beginTitleBarDrag(payload);
});
ipcMain.handle("devhttp:window-update-titlebar-drag", (_event, payload) => {
  return updateTitleBarDrag(payload);
});
ipcMain.handle("devhttp:window-end-titlebar-drag", () => {
  return endTitleBarDrag();
});
ipcMain.handle("devhttp:set-titlebar-theme", (_event, theme) => {
  return setTitleBarTheme(theme);
});

ipcMain.handle("devhttp:execute-local-request", async (_event, payload) => {
  return executeRequestLocally({
    ...payload,
    source: "desktop-local",
  });
});

ipcMain.handle("devhttp:get-workspace-snapshot", async (_event, userId) => {
  if (!userId || typeof userId !== "string") {
    return null;
  }

  const store = readWorkspaceSnapshots();
  return store[userId] ?? null;
});

ipcMain.handle("devhttp:save-workspace-snapshot", async (_event, userId, snapshot) => {
  if (!userId || typeof userId !== "string") {
    return false;
  }

  const store = readWorkspaceSnapshots();
  store[userId] = snapshot;
  writeWorkspaceSnapshots(store);
  return true;
});

ipcMain.handle("devhttp:clear-workspace-snapshot", async (_event, userId) => {
  if (!userId || typeof userId !== "string") {
    return false;
  }

  const store = readWorkspaceSnapshots();
  delete store[userId];
  writeWorkspaceSnapshots(store);
  return true;
});

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
