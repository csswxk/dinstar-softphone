const { app, BrowserWindow } = require("electron");
const path = require("path");

// TEMP: allow self-signed certs for WSS testing. Remove for production.
app.commandLine.appendSwitch("ignore-certificate-errors");

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

  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        "did-fail-load:",
        errorCode,
        errorDescription,
        validatedURL
      );
    }
  );

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(app.getAppPath(), "web-dist", "index.html");
    win.loadFile(indexPath);
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
