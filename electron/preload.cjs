const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("baresip", {
  start: (config) => ipcRenderer.invoke("baresip:start", config),
  stop: () => ipcRenderer.invoke("baresip:stop"),
  command: (cmd) => ipcRenderer.invoke("baresip:command", cmd),
  onLog: (cb) => {
    ipcRenderer.removeAllListeners("baresip:log");
    ipcRenderer.on("baresip:log", (_evt, line) => cb(line));
  },
  onState: (cb) => {
    ipcRenderer.removeAllListeners("baresip:state");
    ipcRenderer.on("baresip:state", (_evt, state) => cb(state));
  },
});
