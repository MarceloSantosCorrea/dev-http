const { BrowserWindow, app, shell } = require("electron");

function getTargetUrl() {
  if (process.env.DEVHTTP_DESKTOP_URL) {
    return process.env.DEVHTTP_DESKTOP_URL;
  }

  if (app.isPackaged) {
    return "https://devhttp.marcelocorrea.com.br";
  }

  return "http://localhost:3000";
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
