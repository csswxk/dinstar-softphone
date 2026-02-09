const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// TEMP: allow self-signed certs for WSS testing. Remove for production.
app.commandLine.appendSwitch("ignore-certificate-errors");

let baresipProc = null;
let baresipReady = false;
let pendingAccount = null;
let lastWindow = null;

function sendToRenderer(channel, payload) {
  if (lastWindow && !lastWindow.isDestroyed()) {
    lastWindow.webContents.send(channel, payload);
  }
}

function findBaresipBinary() {
  const bundled = path.join(process.resourcesPath, "baresip");
  const candidates = [
    process.env.BARESIP_PATH,
    bundled,
    "baresip",
    "/opt/homebrew/bin/baresip",
    "/usr/local/bin/baresip",
    "/usr/bin/baresip",
  ].filter(Boolean);

  for (const bin of candidates) {
    try {
      if (bin === "baresip") return bin;
      fs.accessSync(bin, fs.constants.X_OK);
      return bin;
    } catch (_) {
      // try next candidate
    }
  }
  return null;
}

function parseBaresipLine(line) {
  const l = line.toLowerCase();
  if (l.includes("user agents (1)") || l.includes("creating ua")) return { ua: "started" };
  if (l.includes("registered")) return { reg: "registered" };
  if (l.includes("unregistered") || l.includes("unreg")) return { reg: "not registered" };
  if (l.includes("incoming call")) return { call: "incoming" };
  if (l.includes("call established") || l.includes("established")) return { call: "established" };
  if (l.includes("call terminated") || l.includes("terminated")) return { call: "terminated" };
  return null;
}

function startBaresip({ account }) {
  if (baresipProc) return;

  const baresipBin = findBaresipBinary();
  if (!baresipBin) {
    sendToRenderer("baresip:log", "[err] baresip not found. Install it or set BARESIP_PATH.");
    sendToRenderer("baresip:state", { ua: "failed" });
    return;
  }

  baresipProc = spawn(baresipBin, [], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  baresipReady = true;
  pendingAccount = account || null;

  baresipProc.stdout.on("data", (data) => {
    const text = data.toString();
    text.split(/\r?\n/).forEach((line) => {
      if (!line) return;
      sendToRenderer("baresip:log", line);
      if (line.toLowerCase().includes("baresip is ready")) {
        baresipReady = true;
        if (pendingAccount) {
          // Use slash commands when running without a TTY.
          sendBaresipCommand(`/uanew ${pendingAccount}`);
          pendingAccount = null;
        }
      }
      const state = parseBaresipLine(line);
      if (state) sendToRenderer("baresip:state", state);
    });
  });

  baresipProc.stderr.on("data", (data) => {
    const text = data.toString();
    text.split(/\r?\n/).forEach((line) => {
      if (!line) return;
      sendToRenderer("baresip:log", `[err] ${line}`);
      const state = parseBaresipLine(line);
      if (state) sendToRenderer("baresip:state", state);
    });
  });

  baresipProc.on("exit", (code) => {
    sendToRenderer("baresip:log", `baresip exited (${code ?? "unknown"})`);
    sendToRenderer("baresip:state", { ua: "stopped" });
    baresipProc = null;
    baresipReady = false;
  });

  baresipProc.on("error", (err) => {
    sendToRenderer("baresip:log", `[err] baresip spawn error: ${err.message}`);
    sendToRenderer("baresip:state", { ua: "failed" });
    baresipProc = null;
    baresipReady = false;
  });

  if (account) {
    // Create UA after "baresip is ready" log line.
    pendingAccount = account;
  }
}

function stopBaresip() {
  if (!baresipProc) return;
  try {
    baresipProc.stdin.write("quit\n");
  } catch (_) {
    baresipProc.kill();
  }
}

function sendBaresipCommand(cmd) {
  if (!baresipProc) return;
  baresipProc.stdin.write(`${cmd}\n`);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 740,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs")
    }
  });
  lastWindow = win;

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

ipcMain.handle("baresip:start", (_evt, payload) => {
  startBaresip(payload);
  sendToRenderer("baresip:state", { ua: "started" });
  return { ok: true };
});

ipcMain.handle("baresip:stop", () => {
  stopBaresip();
  return { ok: true };
});

ipcMain.handle("baresip:command", (_evt, cmd) => {
  sendBaresipCommand(cmd);
  return { ok: true };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopBaresip();
});
