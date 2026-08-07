"use client";

import { isElectron } from "@/lib/electron-api";
import type { FileItem } from "./Converter";
import { FolderIcon, SpinnerIcon, TransformIcon, TrashIcon } from "./icons";

interface Props {
  files: FileItem[];
  running: boolean;
  outputMode: "source" | "folder";
  onOutputMode: (m: "source" | "folder") => void;
  outputFolder: string | null;
  onPickFolder: () => void;
  onForgetFolder: () => void;
  onConvert: () => void;
  onRetryFailed: () => void;
  onClearCompleted: () => void;
}

export default function Toolbar({
  files,
  running,
  outputMode,
  onOutputMode,
  outputFolder,
  onPickFolder,
  onForgetFolder,
  onConvert,
  onRetryFailed,
  onClearCompleted,
}: Props) {
  const readyCount = files.filter((f) => f.status === "idle" || f.status === "error").length;
  const doneCount = files.filter((f) => f.status === "done").length;
  const failedCount = files.filter((f) => f.status === "error").length;

  return (
    <div className="panel-shell animate-slide-up">
      <div className="panel-core flex flex-wrap items-center gap-4 p-3 sm:p-4">
      {/* output location */}
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">
          Save to
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOutputMode("source")}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition duration-300 ${
              outputMode === "source"
                ? "border-[#69dfcb]/45 bg-[#69dfcb]/[0.08] text-[#a9f2e5]"
                : "border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200"
            }`}
          >
            Next to source
          </button>
          <button
            type="button"
            onClick={() => onOutputMode("folder")}
            className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
              outputMode === "folder"
                ? "border-[#69dfcb]/45 bg-[#69dfcb]/[0.08] text-[#a9f2e5]"
                : "border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200"
            }`}
          >
            Custom folder
          </button>
          {outputMode === "folder" && (
            <>
              <button
                type="button"
                onClick={onPickFolder}
                className="inline-flex max-w-[220px] items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300 transition hover:border-white/25"
                title={outputFolder ?? "No folder selected"}
              >
                <FolderIcon className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                <span className="truncate">{outputFolder ?? "Choose folder…"}</span>
              </button>
              {outputFolder && (
                <button
                  type="button"
                  onClick={onForgetFolder}
                  className="rounded-lg px-2 py-1.5 text-[11px] text-slate-500 transition hover:bg-white/[0.05] hover:text-slate-200"
                >
                  Forget
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* always best quality — no user setting */}
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">
          Quality
        </span>
        <div className="inline-flex items-center gap-2 rounded-lg border border-[#69dfcb]/20 bg-[#69dfcb]/[0.07] px-3 py-2 text-xs font-medium text-[#a9f2e5]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#69dfcb]" />
          Automatic quality
        </div>
      </div>

      <div className="flex-1" />

      {/* clear completed */}
      {failedCount > 0 && (
        <button
          type="button"
          onClick={onRetryFailed}
          disabled={running || !isElectron}
          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2.5 text-xs text-rose-200 transition hover:border-rose-300/40 hover:bg-rose-400/[0.1] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Retry failed ({failedCount})
        </button>
      )}

      {doneCount > 0 && (
        <button
          type="button"
          onClick={onClearCompleted}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-slate-400 transition hover:text-slate-200"
        >
          <TrashIcon className="h-3.5 w-3.5" />
          Clear completed
        </button>
      )}

      {/* convert */}
      <button
        type="button"
        onClick={onConvert}
        disabled={running || readyCount === 0 || !isElectron}
        className="btn-primary group inline-flex items-center gap-3 rounded-full px-5 py-2.5 text-sm font-semibold"
      >
        {running ? (
          <>
            <SpinnerIcon className="h-4 w-4" /> Converting…
          </>
        ) : (
          <>
            Convert {readyCount > 0 ? `(${readyCount})` : ""}
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/10 transition-transform duration-300 group-hover:translate-x-0.5">
              <TransformIcon className="h-4 w-4" />
            </span>
          </>
        )}
      </button>
      </div>
    </div>
  );
}
