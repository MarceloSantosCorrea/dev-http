const { app, BrowserWindow, Menu, Tray, nativeImage, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const packageJson = require("./package.json");
const { startAgentServer, stopAgentServer, DEFAULT_AGENT_PORT } = require("./server");

if (process.platform === "linux") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
}

let tray = null;
let statusWindow = null;
let activeServer = null;
let agentConfig = null;
let isQuitting = false;

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="16" fill="#0b1420"/>
      <path d="M20 18h16c8.837 0 16 7.163 16 16v12" fill="none" stroke="#2dd4bf" stroke-width="6" stroke-linecap="round"/>
      <path d="M20 46V18h18" fill="none" stroke="#e2e8f0" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `.trim();
  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)
    .resize({ width: 18, height: 18 });
}

function getStatusHtml() {
  const port = agentConfig?.port || DEFAULT_AGENT_PORT;
  return `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <title>DevHttp Agent</title>
      <style>
        :root { color-scheme: dark; }
        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: #08111d;
          color: #e5eef8;
          padding: 20px;
        }
        .card {
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 18px;
          padding: 18px;
          background: linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(8, 17, 29, 0.98));
          box-shadow: 0 24px 60px rgba(8, 15, 26, 0.32);
        }
        .eyebrow {
          font-size: 11px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #2dd4bf;
          font-weight: 700;
        }
        h1 { margin: 10px 0 6px; font-size: 22px; }
        p { margin: 0; color: #94a3b8; line-height: 1.5; }
        .endpoint {
          margin-top: 18px;
          padding: 12px 14px;
          border-radius: 12px;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(45, 212, 191, 0.2);
          font-family: "SFMono-Regular", ui-monospace, monospace;
          color: #f8fafc;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="eyebrow">DevHttp Agent</div>
        <h1>Agent ativo</h1>
        <p>O agent local está disponível em background e pronto para executar requests para localhost e rede privada.</p>
        <div class="endpoint">http://127.0.0.1:${port}</div>
      </div>
    </body>
  </html>`;
}

function createStatusWindow() {
  statusWindow = new BrowserWindow({
    width: 420,
    height: 260,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#08111d",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  statusWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      statusWindow.hide();
    }
  });

  void statusWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getStatusHtml())}`);
}

function toggleStatusWindow() {
  if (!statusWindow) {
    return;
  }

  if (statusWindow.isVisible()) {
    statusWindow.hide();
    return;
  }

  statusWindow.show();
  statusWindow.focus();
}

function refreshTrayMenu() {
  if (!tray) {
    return;
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Abrir status",
        click: () => toggleStatusWindow(),
      },
      {
        label: "Abrir DevHttp",
        click: () => {
          void shell.openExternal("https://devhttp.marcelocorrea.com.br");
        },
      },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function ensureAutoStart() {
  if (process.platform === "darwin" || process.platform === "win32") {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
    });
    return;
  }

  if (process.platform === "linux") {
    const autostartDir = path.join(app.getPath("home"), ".config", "autostart");
    fs.mkdirSync(autostartDir, { recursive: true });
    const desktopFile = path.join(autostartDir, "devhttp-agent.desktop");
    const executable = process.env.APPIMAGE || process.execPath;
    const desktopEntry = `[Desktop Entry]
Type=Application
Version=1.0
Name=DevHttp Agent
Comment=Agent local do DevHttp
Exec=${JSON.stringify(executable)}
X-GNOME-Autostart-enabled=true
Terminal=false
`;
    fs.writeFileSync(desktopFile, desktopEntry, "utf8");
  }
}

async function bootstrapAgent() {
  const started = await startAgentServer();
  activeServer = started.server;
  agentConfig = started.config;
}

async function createApp() {
  await bootstrapAgent();

  createStatusWindow();
  tray = new Tray(createTrayIcon());
  tray.setToolTip("DevHttp Agent");
  tray.on("click", () => toggleStatusWindow());
  refreshTrayMenu();
  ensureAutoStart();

  if (process.platform === "darwin" && app.dock) {
    app.dock.hide();
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.marcelosantoscorrea.devhttp.agent");
  return createApp();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("before-quit", async () => {
  isQuitting = true;
  if (activeServer) {
    await stopAgentServer(activeServer);
    activeServer = null;
  }
});
