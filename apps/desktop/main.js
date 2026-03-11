const { BrowserWindow, app, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const { executeRequestLocally } = require("@devhttp/local-executor");

if (process.platform === "linux") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
}

const WORKSPACE_SNAPSHOT_FILE = "workspace-snapshots.json";

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

function createWindow() {
  const targetUrl = getTargetUrl();
  const allowedOrigin = new URL(targetUrl).origin;
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    backgroundColor: "#09111e",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
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
