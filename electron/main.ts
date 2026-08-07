// ============================================================
// L2L — Electron main process
// Windows, native dialogs, secure IPC. All conversions happen here.
// ============================================================

import path from "node:path";
import fs from "node:fs";

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";

import {
  ALL_EXTS,
  AUDIO_EXTS,
  DOC_EXTS,
  IMAGE_EXTS,
  VIDEO_EXTS,
} from "../shared/formats";
import type { ConvertJob } from "../shared/ipc";
import { convertJob } from "./converters";
import { serveStatic, StaticServer } from "./static-server";

const isDev = Boolean(process.env.ELECTRON_START_URL);
const VALID_QUALITIES = ["low", "normal", "high", "lossless"];
const VALID_PREFERENCES = new Set(["outputFolder"]);
const knownOutputPaths = new Set<string>();

// A local file converter needs no GPU — disabling it improves stability
// on VMs and machines without proper graphics drivers.
app.disableHardwareAcceleration();
app.enableSandbox();

let mainWindow: BrowserWindow | null = null;
let staticServer: StaticServer | null = null;
let prodUrl: string | null = null;

// ---- single instance: focus the existing window instead of forking ----
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });
}

function createWindow(): void {
  // Resolve the bundled icon from the app root in both dev and packaged builds.
  // The old relative path pointed outside the packaged app after electron-builder
  // moved the renderer and Electron files into resources/app.asar.
  const iconPath = path.join(app.getAppPath(), "assets", "icon.png");
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: "#060910",
    show: false,
    title: "L2L — Local File Converter",
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, // renderer never touches Node directly
      sandbox: true, // OS-level renderer sandbox
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // Safety net: never let the window stay hidden. ready-to-show may never
  // fire on some Wayland/GPU combos — if the page loaded but the window is
  // still invisible after 2s, force-show it.
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
    }, 2000);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // ---- navigation lockdown: the app never leaves its own content ----
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = isDev
      ? url.startsWith(process.env.ELECTRON_START_URL as string)
      : prodUrl !== null && url.startsWith(prodUrl);
    if (!allowed) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (isDev) {
    void mainWindow.loadURL(process.env.ELECTRON_START_URL as string);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadURL(prodUrl + "/index.html");
  }

  // env-gated pixel test: capture the window and save a PNG to prove painting works
  if (process.env.L2L_CAPTURE_TEST) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        mainWindow?.webContents
          .capturePage()
          .then((image) => {
            fs.writeFileSync(process.env.L2L_CAPTURE_FILE || "/tmp/l2l-shot.png", image.toPNG());
            const size = image.getSize();
            fs.writeSync(1, `CAPTURE ${process.env.L2L_CAPTURE_FILE || "/tmp/l2l-shot.png"} size=${size.width}x${size.height}\n`);
            app.exit(0);
          })
          .catch((err) => {
            fs.writeSync(1, "CAPTURE_ERROR " + (err instanceof Error ? err.message : String(err)) + "\n");
            app.exit(1);
          });
      }, 1500);
    });
  }

  // env-gated smoke test: verify the renderer actually rendered, then quit
  if (process.env.L2L_SMOKE_TEST) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow?.webContents
        .executeJavaScript(
          "JSON.stringify({title: document.title, hasBridge: !!window.electronAPI, h1: (document.querySelector('h1')||{}).textContent || ''})",
        )
        .then((info) => {
          // sync write: app.exit() would otherwise truncate buffered stdout
          fs.writeSync(1, "SMOKE_TEST " + info + "\n");
          app.exit(0);
        })
        .catch((err) => {
          fs.writeSync(1, "SMOKE_TEST_ERROR " + (err instanceof Error ? err.message : String(err)) + "\n");
          app.exit(1);
        });
    });
  }
}

// ------------------------------------------------------------
// IPC handlers — every channel is narrow, validated and promise-based
// ------------------------------------------------------------

function isTrustedSender(sender: Electron.WebContents): boolean {
  return Boolean(mainWindow && sender === mainWindow.webContents);
}

ipcMain.handle("selectFiles", async (event) => {
  if (!isTrustedSender(event.sender)) return [];
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (!win) return [];

  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Select files to convert",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Supported files", extensions: ALL_EXTS },
      { name: "Images", extensions: IMAGE_EXTS },
      { name: "Video", extensions: VIDEO_EXTS },
      { name: "Audio", extensions: AUDIO_EXTS },
      { name: "Documents", extensions: DOC_EXTS },
    ],
  });
  if (canceled) return [];

  return filePaths.map((p) => {
    let size = 0;
    try {
      size = fs.statSync(p).size;
    } catch {
      /* ignore */
    }
    return { path: p, size };
  });
});

ipcMain.handle("selectOutputFolder", async (event) => {
  if (!isTrustedSender(event.sender)) return null;
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (!win) return null;

  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: "Select output folder",
    properties: ["openDirectory", "createDirectory"],
  });
  return canceled || filePaths.length === 0 ? null : filePaths[0];
});

function preferencesPath(): string {
  return path.join(app.getPath("userData"), "preferences.json");
}

function readPreferences(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(preferencesPath(), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] =>
        typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

ipcMain.handle("getPreference", (event, key: unknown) => {
  if (!isTrustedSender(event.sender) || typeof key !== "string" || !VALID_PREFERENCES.has(key)) return null;
  return readPreferences()[key] ?? null;
});

ipcMain.handle("setPreference", (event, key: unknown, value: unknown) => {
  if (!isTrustedSender(event.sender) || typeof key !== "string" || !VALID_PREFERENCES.has(key)) return;
  if (value !== null && typeof value !== "string") return;
  const preferences = readPreferences();
  if (value === null) delete preferences[key];
  else preferences[key] = value.slice(0, 4096);
  fs.mkdirSync(path.dirname(preferencesPath()), { recursive: true });
  fs.writeFileSync(preferencesPath(), JSON.stringify(preferences, null, 2), "utf8");
});

ipcMain.handle("convert", async (event, job: ConvertJob) => {
  if (!isTrustedSender(event.sender)) return { ok: false, error: "Forbidden." };
  const sender = event.sender;

  const report = (e: { percent?: number; stage?: string; pages?: unknown }) => {
    try {
      sender.send("convert:progress", { id: job?.id, ...e });
    } catch {
      /* window may be closed mid-conversion */
    }
  };

  // ---- validate payload shape before anything touches disk ----
  if (
    !job ||
    typeof job !== "object" ||
    typeof job.id !== "string" ||
    typeof job.inputPath !== "string" ||
    typeof job.target !== "string" ||
    !VALID_QUALITIES.includes(job.quality) ||
    (job.outputDir != null && typeof job.outputDir !== "string")
  ) {
    return { ok: false, error: "Invalid job payload." };
  }

  try {
    const outputs = await convertJob(job, report);
    for (const output of outputs) knownOutputPaths.add(path.resolve(output));
    return { ok: true, outputs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
});

ipcMain.handle("revealFile", (event, p: unknown) => {
  if (!isTrustedSender(event.sender)) return;
  if (typeof p === "string") {
    const resolved = path.resolve(p);
    if (!knownOutputPaths.has(resolved) || !fs.existsSync(resolved)) return;
    shell.showItemInFolder(resolved);
  }
});

// ------------------------------------------------------------

app.whenReady().then(async () => {
  // clean, app-like window (no default menu bar)
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);

  // serve the static export over loopback (file:// breaks Next's absolute asset paths)
  if (!isDev) {
    staticServer = await serveStatic(path.join(__dirname, "../../out"));
    prodUrl = staticServer.url;
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  staticServer?.close();
});
