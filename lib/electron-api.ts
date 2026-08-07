import type { ElectronAPI } from "@/shared/ipc";

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export const api: ElectronAPI | undefined =
  typeof window !== "undefined" ? window.electronAPI : undefined;

export const isElectron = typeof window !== "undefined" && Boolean(window.electronAPI);
