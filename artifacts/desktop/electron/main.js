"use strict";

const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("node:path");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");

// ── Constants ─────────────────────────────────────────────────────────────────
const DESKTOP_PORT = 9999;
const IS_DEV = !app.isPackaged;
const DEV_URL = process.env.DEV_FRONTEND_URL || "http://localhost:23457";

// ── Load .env file (user config next to exe or in app userData) ───────────────
function loadEnvFile() {
  const locations = [];

  if (IS_DEV) {
    // Dev mode: load from repo root
    locations.push(path.resolve(__dirname, "..", "..", "..", ".env"));
    locations.push(path.resolve(__dirname, "..", "..", "..", ".env.local"));
  } else {
    // Production: look next to the exe and in userData
    const exeDir = path.dirname(process.execPath);
    locations.push(path.join(exeDir, "GymPro.env"));
    locations.push(path.join(app.getPath("userData"), "GymPro.env"));
  }

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      const content = fs.readFileSync(loc, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (key && !process.env[key]) process.env[key] = val;
      }
      console.log(`[GymPro] Loaded env from: ${loc}`);
      break;
    }
  }
}

// ── Wait for the backend to be ready ─────────────────────────────────────────
function waitForServer(port, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      http.get(`http://localhost:${port}/api/healthz`, (res) => {
        if (res.statusCode < 500) {
          resolve();
        } else {
          retry();
        }
      }).on("error", () => {
        retry();
      });
    }
    function retry() {
      if (Date.now() - start > timeout) {
        reject(new Error(`Backend did not start within ${timeout / 1000}s`));
      } else {
        setTimeout(check, 500);
      }
    }
    check();
  });
}

// ── Spawn the backend server ──────────────────────────────────────────────────
let backendProcess = null;

function startBackend(frontendDir) {
  const serverBundle = IS_DEV
    ? path.resolve(__dirname, "..", "..", "..", "artifacts", "api-server", "dist", "index.mjs")
    : path.join(process.resourcesPath, "server", "index.mjs");

  if (!fs.existsSync(serverBundle)) {
    throw new Error(
      `Backend bundle not found at:\n${serverBundle}\n\nRun "pnpm --filter @workspace/desktop run build:server" first.`
    );
  }

  const env = {
    ...process.env,
    PORT: String(DESKTOP_PORT),
    NODE_ENV: IS_DEV ? "development" : "production",
    ELECTRON_STATIC_DIR: frontendDir,
  };

  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set.\n\nCreate a GymPro.env file next to the GymPro executable with:\n\nDATABASE_URL=postgres://user:pass@host:5432/dbname\n\nThen restart GymPro."
    );
  }

  backendProcess = spawn(process.execPath, [serverBundle], {
    env,
    stdio: IS_DEV ? "inherit" : "pipe",
    detached: false,
  });

  if (!IS_DEV && backendProcess.stdout) {
    backendProcess.stdout.on("data", (d) => console.log("[server]", d.toString().trim()));
  }
  if (!IS_DEV && backendProcess.stderr) {
    backendProcess.stderr.on("data", (d) => console.error("[server]", d.toString().trim()));
  }

  backendProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[GymPro] Backend exited with code ${code}`);
    }
  });

  return backendProcess;
}

// ── Create the main window ────────────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  const iconPath = IS_DEV
    ? path.resolve(__dirname, "..", "assets", "icon.png")
    : path.join(process.resourcesPath, "icon.png");

  mainWindow = new BrowserWindow({
    title: "GymPro",
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#0f172a",
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: IS_DEV,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (!IS_DEV) {
    mainWindow.removeMenu();
  }

  return mainWindow;
}

// ── Show fatal error ──────────────────────────────────────────────────────────
function showFatalError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[GymPro] Fatal:", msg);

  if (mainWindow) {
    mainWindow.loadURL(`data:text/html,${encodeURIComponent(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><style>
        body { font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; }
        h1 { color: #ef4444; } pre { background: #1e293b; padding: 20px; border-radius: 8px;
        white-space: pre-wrap; font-size: 14px; }
      </style></head>
      <body>
        <h1>GymPro failed to start</h1>
        <pre>${msg.replace(/</g, "&lt;")}</pre>
        <p>Check the GymPro.env file next to the executable and restart the app.</p>
      </body>
      </html>
    `)}`);
    mainWindow.show();
    return;
  }

  dialog.showErrorBox("GymPro — Startup Error", msg);
  app.quit();
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  loadEnvFile();

  const frontendDir = IS_DEV
    ? path.resolve(__dirname, "..", "..", "..", "artifacts", "gym-app", "dist", "public")
    : path.join(process.resourcesPath, "frontend");

  // Create the window immediately so we can show errors in it
  createWindow();

  try {
    startBackend(frontendDir);
    await waitForServer(DESKTOP_PORT);

    const appUrl = `http://localhost:${DESKTOP_PORT}`;
    mainWindow.loadURL(appUrl);
  } catch (err) {
    showFatalError(err);
  }
});

app.on("window-all-closed", () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  if (backendProcess) backendProcess.kill();
});
