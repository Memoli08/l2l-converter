// ============================================================
// IPC contract — data types shared between main and renderer
// Used by both the Electron side and the Next.js frontend.
// ============================================================

import type { Quality } from "./formats";

export interface ConvertJob {
  id: string; // client-generated unique id
  inputPath: string;
  target: string; // target format id (e.g. 'mp4', 'pdf')
  quality: Quality;
  outputDir?: string; // if empty, the source file's folder is used
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
  onProgress(cb: (e: ProgressEvent) => void): () => void;
  revealFile(path: string): void;
  getPathForFile(file: File): string;
}
