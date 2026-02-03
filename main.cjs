const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 740,
    webPreferences: {
      contextIsolation: true
    }
  });

  const isDev = !app.isPackaged;

  console.log("isDev:", !app.isPackaged);

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(process.resourcesPath, "web-dist", "index.html");
    win.loadFile(indexPath);
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
