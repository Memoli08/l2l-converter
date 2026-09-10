"use client";

import { useCallback, useState } from "react";

import { api, isElectron } from "@/lib/electron-api";
import { extOf, isSupported } from "@/shared/formats";
import { FolderIcon, PlusIcon, TransformIcon } from "./icons";

export interface AddedFile {
  path: string;
  size: number;
}

interface Props {
  compact?: boolean;
  onAdd: (entries: AddedFile[]) => void;
  /** Optional browse override (used by the showcase “Browse files” CTA). */
  onBrowse?: () => Promise<void> | void;
}

export default function Dropzone({ compact = false, onAdd, onBrowse }: Props) {
  const [active, setActive] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  const browse = useCallback(async () => {
    if (onBrowse) {
      await onBrowse();
      return;
    }
    if (!api) return;
    const entries = await api.selectFiles();
    if (entries.length) onAdd(entries);
  }, [onAdd, onBrowse]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setActive(false);
      const electronApi = api;
      if (!electronApi) return;
      const allFiles = Array.from(e.dataTransfer.files);
      const supported = allFiles.filter((f) => isSupported(extOf(f.name)));
      const unsupported = allFiles.filter((f) => !isSupported(extOf(f.name))).map((f) => f.name);
      if (unsupported.length) {
        setRejected(unsupported.slice(0, 5));
        window.setTimeout(() => setRejected([]), 4000);
      }
      const entries: AddedFile[] = supported.map((f) => ({ path: electronApi.getPathForFile(f), size: f.size }));
      if (entries.length) onAdd(entries);
    },
    [onAdd],
  );

  const dragProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setActive(true);
    },
    onDragLeave: () => setActive(false),
    onDrop: handleDrop,
  };

  // ---------- compact variant: small "add more" strip ----------
  if (compact) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={browse}
          disabled={!isElectron}
          {...dragProps}
          className={`dropzone-shell group flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-3 text-sm text-slate-400 transition hover:border-[#69dfcb]/50 hover:text-[#a9f2e5] disabled:cursor-not-allowed disabled:opacity-50 ${
            active ? "dropzone-active" : ""
          }`}
        >
          <PlusIcon className="h-4 w-4 transition-transform group-hover:rotate-90" />
          <span>Drop more files here or <span className="font-medium text-violet-300">browse</span>…</span>
        </button>
        {rejected.length > 0 && (
          <p className="animate-fade-in rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
            Skipped unsupported: {rejected.join(", ")}{rejected.length >= 5 ? "…" : ""}
          </p>
        )}
      </div>
    );
  }

  // ---------- hero variant (fills available space) ----------
  return (
    <div
      onClick={browse}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") browse();
      }}
      {...dragProps}
      className={`dropzone-shell group flex w-full cursor-pointer flex-col items-center justify-center gap-6 rounded-[1.7rem] border border-dashed border-white/15 bg-white/[0.025] px-6 py-12 text-center shadow-[inset_0_1px_0_rgba(232,255,251,0.03)] sm:px-10 ${
        active ? "dropzone-active" : ""
      }`}
    >
      <div className="flex h-20 w-20 items-center justify-center rounded-[1.5rem] border border-[#69dfcb]/20 bg-[#69dfcb]/[0.07] text-[#a9f2e5] shadow-[inset_0_1px_0_rgba(232,255,251,0.1)] transition-transform duration-300 group-hover:scale-105">
        <TransformIcon className="h-10 w-10" />
      </div>

      <div>
        <p className="text-2xl font-semibold tracking-[-0.04em] text-slate-100 sm:text-3xl">
          Drop files here, or <span className="text-[#69dfcb]">browse</span>
        </p>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
          Move images, video, audio, documents and 3D models between formats.
          Multiple files stay on your device from start to finish.
        </p>
        <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-medium text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-[#69dfcb]" />
          45+ formats · batch ready · local only
        </p>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void browse();
        }}
        disabled={!isElectron}
        className="btn-primary inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white"
      >
        <FolderIcon className="h-4 w-4" />
        Browse files
      </button>

      {rejected.length > 0 && (
        <p className="animate-fade-in max-w-xl rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          Skipped unsupported files: {rejected.join(", ")}{rejected.length >= 5 ? "…" : ""} — only 45+ listed formats are supported.
        </p>
      )}

      {!isElectron && (
        <p className="text-xs text-amber-300/80">
          Running in a browser — launch the desktop app with{" "}
          <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono">npm start</code> to convert.
        </p>
      )}
    </div>
  );
}
