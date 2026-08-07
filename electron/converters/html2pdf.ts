// ============================================================
// L2L — HTML → PDF via a single reused, hidden, sandboxed window
// Creating/destroying BrowserWindows in rapid succession can
// crash the GPU process on some systems, so we keep ONE hidden
// window for the whole session and serialize jobs with a mutex.
// User-supplied HTML may be rendered, but its renderer is isolated and all
// network protocols are blocked. PDF generation therefore remains local.
// ============================================================

import fs from "node:fs";
import path from "node:path";

import { app, BrowserWindow } from "electron";

let chain: Promise<unknown> = Promise.resolve();
let sharedWin: BrowserWindow | null = null;

function getWindow(): BrowserWindow {
  if (!sharedWin || sharedWin.isDestroyed()) {
    sharedWin = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: "l2l-pdf-renderer",
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        javascript: false,
        webSecurity: true,
      },
    });
    // Allow only the local temporary document and inline data URLs. Remote
    // images, fonts, stylesheets, frames and redirects are denied before they
    // leave the process; this is intentionally separate from the app session.
    sharedWin.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      const protocol = new URL(details.url).protocol;
      callback({ cancel: protocol !== "file:" && protocol !== "data:" });
    });
  }
  return sharedWin;
}

app.on("before-quit", () => {
  if (sharedWin && !sharedWin.isDestroyed()) sharedWin.destroy();
});

/** Serializes PDF printing so the single hidden window is never used concurrently. */
export function htmlToPdf(html: string, outputPath: string): Promise<void> {
  const run = chain.then(() => doHtmlToPdf(html, outputPath));
  chain = run.catch(() => undefined);
  return run;
}

async function loadWithRetry(
  win: BrowserWindow,
  filePath: string,
  attempts = 3,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await win.loadFile(filePath);
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function doHtmlToPdf(html: string, outputPath: string): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(app.getPath("temp"), "l2l-html-"));
  const tmpFile = path.join(
    tmpDir,
    `l2l-html-${Date.now()}-${Math.random().toString(36).slice(2)}.html`,
  );
  fs.writeFileSync(tmpFile, html, "utf8");

  const win = getWindow();
  try {
    await loadWithRetry(win, tmpFile);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { top: 0.79, bottom: 0.79, left: 0.79, right: 0.79 },
    });
    fs.writeFileSync(outputPath, pdf);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
