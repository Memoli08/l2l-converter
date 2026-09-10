// ============================================================
// IPC contract — data types shared between main and renderer
// Used by both the Electron side and the Next.js frontend.
// ============================================================

import type { Quality } from "./formats";

/** CSS hexadecimal color forms accepted by the ASCII renderer. */
export const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export interface ImageOptions {
  width?: number;
  height?: number;
  rotate?: number; // 0,90,180,270
  /** Keep aspect ratio when only one dimension given (default true) */
  fit?: "inside" | "cover" | "fill";
}

export interface ConvertJob {
  id: string; // client-generated unique id
  inputPath: string;
  target: string; // target format id (e.g. 'mp4', 'pdf')
  quality: Quality;
  outputDir?: string; // if empty, the source file's folder is used
  /** Hex color for ASCII art foreground (e.g. '#00ff88'). Omit for default white. */
  color?: string;
  imageOptions?: ImageOptions;
}

export interface ProgressEvent {
  id: string;
  percent: number; // 0..100
  stage?: string; // stage text shown to the user
  pages?: { done: number; total: number };
}

export interface ConvertResult {
  ok: boolean;
  outputs?: string[]; // generated file paths
  error?: string;
}

export interface SelectedFile {
  path: string;
  size: number;
}

export interface ElectronAPI {
  isElectron: boolean;
  selectFiles(): Promise<SelectedFile[]>;
  selectOutputFolder(): Promise<string | null>;
  getPreference(key: "outputFolder"): Promise<string | null>;
  setPreference(key: "outputFolder", value: string | null): Promise<void>;
  convert(job: ConvertJob): Promise<ConvertResult>;
  cancelConvert(id: string): Promise<void>;
  onProgress(cb: (e: ProgressEvent) => void): () => void;
  revealFile(path: string): void;
  getPathForFile(file: File): string;
  /** Read a known output file as UTF-8 text. */
  readFileAsText(filePath: string): Promise<string>;
  /** Read a known output file and return { base64, mime } for blob URL creation. */
  readFileAsBase64(filePath: string): Promise<{ base64: string; mime: string }>;
  /** Get 3D model info (vertices/triangles) for preview. */
  getModelInfo(filePath: string): Promise<{ vertices: number; triangles: number; ext: string } | null>;
  /** Get spreadsheet preview (first 20 rows) as text table. */
  getSpreadsheetPreview(filePath: string): Promise<{ headers: string[]; rows: string[][]; sheetName: string } | null>;
}
