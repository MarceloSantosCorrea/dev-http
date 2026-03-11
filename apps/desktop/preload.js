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
});
