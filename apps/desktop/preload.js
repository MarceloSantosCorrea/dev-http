const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("devHttpDesktop", {
  executeLocalRequest(payload) {
    return ipcRenderer.invoke("devhttp:execute-local-request", payload);
  },
});
