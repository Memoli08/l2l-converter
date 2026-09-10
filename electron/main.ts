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
import { HEX_COLOR_RE, type ConvertJob } from "../shared/ipc";
import { convertJob } from "./converters/index.js";
import { cancelActiveJob } from "./converters/media.js";
import { serveStatic, StaticServer } from "./static-server.js";

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

let prefWriteQueue: Promise<void> = Promise.resolve();
ipcMain.handle("setPreference", (event, key: unknown, value: unknown) => {
  if (!isTrustedSender(event.sender) || typeof key !== "string" || !VALID_PREFERENCES.has(key)) return;
  if (value !== null && typeof value !== "string") return;
  // Serialize writes to avoid race between concurrent setPreference calls
  prefWriteQueue = prefWriteQueue.then(() => {
    const preferences = readPreferences();
    if (value === null) delete preferences[key];
    else preferences[key] = value.slice(0, 4096);
    const dir = path.dirname(preferencesPath());
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.preferences.tmp.${process.pid}`);
    fs.writeFileSync(tmp, JSON.stringify(preferences, null, 2), "utf8");
    fs.renameSync(tmp, preferencesPath());
  }).catch(() => { /* ignore write errors — next write will retry */ });
  return prefWriteQueue;
});

const activeConverts = new Map<string, { cancel: () => void }>();

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
  const MAX_ID_LEN = 128;
  const MAX_PATH_LEN = 4096;
  const validImageOpts = (v: unknown): boolean => {
    if (v == null) return true;
    if (typeof v !== "object" || Array.isArray(v)) return false;
    const o = v as Record<string, unknown>;
    if (o.width != null && (typeof o.width !== "number" || !Number.isFinite(o.width) || o.width < 1 || o.width > 10000)) return false;
    if (o.height != null && (typeof o.height !== "number" || !Number.isFinite(o.height) || o.height < 1 || o.height > 10000)) return false;
    if (o.rotate != null && ![0,90,180,270].includes(o.rotate as number)) return false;
    if (o.fit != null && !["inside","cover","fill"].includes(o.fit as string)) return false;
    return true;
  };
  if (
    !job ||
    typeof job !== "object" ||
    typeof job.id !== "string" || job.id.length === 0 || job.id.length > MAX_ID_LEN ||
    typeof job.inputPath !== "string" || job.inputPath.length === 0 || job.inputPath.length > MAX_PATH_LEN ||
    typeof job.target !== "string" || job.target.length === 0 || job.target.length > 32 ||
    !VALID_QUALITIES.includes(job.quality) ||
    (job.outputDir != null && (typeof job.outputDir !== "string" || job.outputDir.length > MAX_PATH_LEN)) ||
    (job.color != null && (typeof job.color !== "string" || !HEX_COLOR_RE.test(job.color))) ||
    !validImageOpts((job as unknown as Record<string, unknown>).imageOptions)
  ) {
    return { ok: false, error: "Invalid job payload." };
  }

  if (activeConverts.has(job.id)) {
    return { ok: false, error: "A conversion with this job ID is already running." };
  }

  // Track for cancellation. Media converters associate their child process
  // directly with this job ID, so concurrent conversions remain independent.
  let cancelled = false;
  try {
    activeConverts.set(job.id, { cancel: () => { cancelled = true; try { cancelActiveJob(job.id); } catch { /* ignore */ } } });
    const outputs = await convertJob(job, report);
    if (cancelled) throw new Error("Cancelled by user.");
    for (const output of outputs) knownOutputPaths.add(path.resolve(output));
    try { KNOWN_INPUT_PATHS.add(path.resolve(job.inputPath)); } catch { /* ignore */ }
    return { ok: true, outputs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    activeConverts.delete(job.id);
  }
});

ipcMain.handle("cancelConvert", (event, id: unknown) => {
  if (!isTrustedSender(event.sender) || typeof id !== "string") return;
  const entry = activeConverts.get(id);
  if (entry) entry.cancel();
});

ipcMain.handle("revealFile", (event, p: unknown) => {
  if (!isTrustedSender(event.sender)) return;
  if (typeof p === "string") {
    const resolved = path.resolve(p);
    if (!knownOutputPaths.has(resolved) || !fs.existsSync(resolved)) return;
    shell.showItemInFolder(resolved);
  }
});

// ---- file reading for the viewer panel ----
// Only files that have been produced by a conversion (tracked in
// knownOutputPaths) are allowed to be read — this prevents arbitrary
// filesystem reads from the renderer.
// Allowlist is strict: path must be in knownOutputPaths AND exist on disk.
// We also allow reading the original input if it was the source of a job
// that produced an output in this session (defense: attacker can't guess
// arbitrary paths without a successful conversion).
const KNOWN_INPUT_PATHS = new Set<string>();

function isAllowedPath(p: string): boolean {
  const resolved = path.resolve(p);
  if (!fs.existsSync(resolved)) return false;
  if (knownOutputPaths.has(resolved)) return true;
  // Inputs that led to a known output are readable too (for preview comparison)
  if (KNOWN_INPUT_PATHS.has(resolved)) return true;
  return false;
}

function mimeForExt(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
    tiff: "image/tiff", tif: "image/tiff", avif: "image/avif",
    heic: "image/heic", heif: "image/heif",
    svg: "image/svg+xml", pdf: "application/pdf",
    mp4: "video/mp4", webm: "video/webm", mkv: "video/x-matroska",
    mov: "video/quicktime", avi: "video/x-msvideo", mpeg: "video/mpeg", mpg: "video/mpeg",
    ogv: "video/ogg", flv: "video/x-flv", m4v: "video/x-m4v", "3gp": "video/3gpp", wmv: "video/x-ms-wmv",
    mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac",
    ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4",
    aac: "audio/aac", opus: "audio/opus", aiff: "audio/aiff", aif: "audio/aiff",
    ac3: "audio/ac3", wma: "audio/x-ms-wma", amr: "audio/amr",
    txt: "text/plain", md: "text/markdown", csv: "text/csv", html: "text/html", htm: "text/html",
    stl: "model/stl", obj: "model/obj", ply: "model/ply", "3mf": "model/3mf", glb: "model/gltf-binary", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

const MAX_VIEW_BYTES = 64 * 1024 * 1024; // don't base64-encode files >64MB for preview

ipcMain.handle("readFileAsText", (event, filePath: unknown) => {
  if (!isTrustedSender(event.sender) || typeof filePath !== "string") return "";
  if (filePath.length > 4096) return "";
  if (!isAllowedPath(filePath)) return "";
  try {
    const stat = fs.statSync(path.resolve(filePath));
    if (stat.size > MAX_VIEW_BYTES) return "File too large to preview as text (>" + Math.round(MAX_VIEW_BYTES / 1024 / 1024) + "MB).";
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
});

ipcMain.handle("readFileAsBase64", (event, filePath: unknown) => {
  if (!isTrustedSender(event.sender) || typeof filePath !== "string") return { base64: "", mime: "application/octet-stream" };
  if (filePath.length > 4096) return { base64: "", mime: "application/octet-stream" };
  if (!isAllowedPath(filePath)) return { base64: "", mime: "application/octet-stream" };
  try {
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    if (stat.size > MAX_VIEW_BYTES) return { base64: "", mime: "application/octet-stream" };
    const buf = fs.readFileSync(resolved);
    const ext = path.extname(resolved).slice(1).toLowerCase();
    const mime = mimeForExt(ext);
    return { base64: buf.toString("base64"), mime };
  } catch {
    return { base64: "", mime: "application/octet-stream" };
  }
});

ipcMain.handle("getModelInfo", async (event, filePath: unknown) => {
  if (!isTrustedSender(event.sender) || typeof filePath !== "string") return null;
  if (filePath.length > 4096 || !isAllowedPath(filePath)) return null;
  try {
    const resolved = path.resolve(filePath);
    const ext = path.extname(resolved).slice(1).toLowerCase();
    if (!["stl","obj","ply","3mf","glb"].includes(ext)) return null;
    const buf = fs.readFileSync(resolved);
    const { getMeshInfo } = await import("./converters/model3d.js");
    const info = getMeshInfo(buf, ext);
    if (info) return { vertices: info.vertices, triangles: info.triangles, ext };
    const stat = fs.statSync(resolved);
    return { vertices: 0, triangles: 0, ext, size: stat.size } as unknown as { vertices: number; triangles: number; ext: string };
  } catch {
    return null;
  }
});

ipcMain.handle("getSpreadsheetPreview", async (event, filePath: unknown) => {
  if (!isTrustedSender(event.sender) || typeof filePath !== "string") return null;
  if (filePath.length > 4096 || !isAllowedPath(filePath)) return null;
  try {
    const resolved = path.resolve(filePath);
    const ext = path.extname(resolved).slice(1).toLowerCase();
    if (!["xlsx","csv"].includes(ext)) return null;
    if (ext === "csv") {
      const text = fs.readFileSync(resolved, "utf8").slice(0, 50_000);
      const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 21);
      const rows = lines.map((l) => l.split(",").slice(0, 10).map((c) => c.trim().slice(0, 50)));
      const headers = rows.shift() ?? [];
      return { headers, rows: rows.slice(0, 20), sheetName: "CSV" };
    } else {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(resolved);
      const sheet = wb.worksheets[0];
      if (!sheet) return null;
      const headers: string[] = [];
      const rows: string[][] = [];
      sheet.eachRow((row, rowNumber) => {
        const vals = (row.values as unknown[]) as unknown[];
        // ExcelJS row.values is 1-indexed, vals[0] is undefined
        const cells = vals.slice(1).map((v) => String(v ?? "").slice(0, 50));
        if (rowNumber === 1) headers.push(...cells.slice(0, 10));
        else if (rowNumber <= 21) rows.push(cells.slice(0, 10));
      });
      return { headers: headers.slice(0, 10), rows, sheetName: sheet.name || "Sheet1" };
    }
  } catch {
    return null;
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
