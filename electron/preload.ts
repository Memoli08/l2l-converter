// ============================================================
// L2L — Preload bridge
// Exposes ONLY the channels the UI needs, via contextBridge.
// ============================================================

import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { ConvertJob, ConvertResult, ElectronAPI, ProgressEvent } from "../shared/ipc";

const api: ElectronAPI = {
  isElectron: true,

  selectFiles: (): Promise<{ path: string; size: number }[]> =>
    ipcRenderer.invoke("selectFiles"),

  selectOutputFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("selectOutputFolder"),

  getPreference: (key: "outputFolder"): Promise<string | null> =>
    ipcRenderer.invoke("getPreference", key),

  setPreference: (key: "outputFolder", value: string | null): Promise<void> =>
    ipcRenderer.invoke("setPreference", key, value),

  convert: (job: ConvertJob): Promise<ConvertResult> =>
    ipcRenderer.invoke("convert", job),

  cancelConvert: (id: string): Promise<void> =>
    ipcRenderer.invoke("cancelConvert", id),

  onProgress: (cb: (e: ProgressEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, e: ProgressEvent) => cb(e);
    ipcRenderer.on("convert:progress", listener);
    return () => {
      ipcRenderer.removeListener("convert:progress", listener);
    };
  },

  revealFile: (p: string): void => {
    void ipcRenderer.invoke("revealFile", p);
  },

  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  readFileAsText: (filePath: string): Promise<string> =>
    ipcRenderer.invoke("readFileAsText", filePath),

  readFileAsBase64: (filePath: string): Promise<{ base64: string; mime: string }> =>
    ipcRenderer.invoke("readFileAsBase64", filePath),

  getModelInfo: (filePath: string): Promise<{ vertices: number; triangles: number; ext: string } | null> =>
    ipcRenderer.invoke("getModelInfo", filePath),

  getSpreadsheetPreview: (filePath: string): Promise<{ headers: string[]; rows: string[][]; sheetName: string } | null> =>
    ipcRenderer.invoke("getSpreadsheetPreview", filePath),
};

contextBridge.exposeInMainWorld("electronAPI", api);
