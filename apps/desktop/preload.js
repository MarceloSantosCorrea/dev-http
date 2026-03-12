const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("devHttpDesktop", {
  executeLocalRequest(payload) {
    return ipcRenderer.invoke("devhttp:execute-local-request", payload);
  },
  getWorkspaceSnapshot(userId) {
    return ipcRenderer.invoke("devhttp:get-workspace-snapshot", userId);
  },
  saveWorkspaceSnapshot(userId, snapshot) {
    return ipcRenderer.invoke("devhttp:save-workspace-snapshot", userId, snapshot);
  },
  clearWorkspaceSnapshot(userId) {
    return ipcRenderer.invoke("devhttp:clear-workspace-snapshot", userId);
  },
  platform: process.platform,
  isMaximized: () => ipcRenderer.invoke("devhttp:is-maximized"),
  onMaximizeChange: (cb) => {
    ipcRenderer.on("devhttp:maximize-change", (_e, maximized) => cb(maximized));
  },
  minimizeWindow: () => ipcRenderer.invoke("devhttp:window-minimize"),
  maximizeWindow: () => ipcRenderer.invoke("devhttp:window-maximize"),
  closeWindow: () => ipcRenderer.invoke("devhttp:window-close"),
  beginTitleBarDrag: (payload) => ipcRenderer.invoke("devhttp:window-begin-titlebar-drag", payload),
  updateTitleBarDrag: (payload) => ipcRenderer.invoke("devhttp:window-update-titlebar-drag", payload),
  endTitleBarDrag: () => ipcRenderer.invoke("devhttp:window-end-titlebar-drag"),
  setTitleBarTheme: (theme) => ipcRenderer.invoke("devhttp:set-titlebar-theme", theme),
  checkForUpdates: () => ipcRenderer.invoke("devhttp:check-for-updates"),
  openUpdateUrl: (url) => ipcRenderer.invoke("devhttp:open-update-url", url),
});
