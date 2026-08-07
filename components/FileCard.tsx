"use client";

import type { ReactNode } from "react";

import { targetsFor } from "@/shared/formats";
import type { FileItem } from "./Converter";
import { formatSize } from "./Converter";
import {
  AlertIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  AsciiIcon,
  AudioIcon,
  BoxIcon,
  CheckIcon,
  DocIcon,
  ExternalIcon,
  ImageIcon,
  SpinnerIcon,
  TrashIcon,
  TransformIcon,
  VideoIcon,
  WandIcon,
} from "./icons";

const KIND_STYLES: Record<
  string,
  { icon: ReactNode; tile: string; badge: string }
> = {
  image: {
    icon: <ImageIcon className="h-5 w-5" />,
    tile: "border-emerald-400/20 bg-emerald-500/15 text-emerald-300",
    badge: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
  },
  video: {
    icon: <VideoIcon className="h-5 w-5" />,
    tile: "border-rose-400/20 bg-rose-500/15 text-rose-300",
    badge: "border-rose-400/20 bg-rose-500/10 text-rose-300",
  },
  audio: {
    icon: <AudioIcon className="h-5 w-5" />,
    tile: "border-amber-400/20 bg-amber-500/15 text-amber-300",
    badge: "border-amber-400/20 bg-amber-500/10 text-amber-300",
  },
  document: {
    icon: <DocIcon className="h-5 w-5" />,
    tile: "border-sky-400/20 bg-sky-500/15 text-sky-300",
    badge: "border-sky-400/20 bg-sky-500/10 text-sky-300",
  },
  model: {
    icon: <BoxIcon className="h-5 w-5" />,
    tile: "border-orange-400/20 bg-orange-500/15 text-orange-300",
    badge: "border-orange-400/20 bg-orange-500/10 text-orange-300",
  },
};

interface Props {
  item: FileItem;
  index: number;
  total: number;
  disabled: boolean;
  onRemove: (id: string) => void;
  onTargetChange: (id: string, target: string) => void;
  onReveal: (path: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
}

export default function FileCard({ item, index, total, disabled, onRemove, onTargetChange, onReveal, onMove }: Props) {
  const kindStyle = item.kind ? KIND_STYLES[item.kind] : KIND_STYLES.document;
  const targets = targetsFor(item.ext);
  const done = item.status === "done";

  return (
    <div
      className={`panel-shell animate-slide-up group transition-all duration-300 hover:border-[#69dfcb]/25 ${
        done ? "border-emerald-400/20" : ""
      }`}
      style={{ animationDelay: `${Math.min(index * 45, 400)}ms` }}
    >
      <div className="panel-core flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        {/* kind tile */}
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${kindStyle.tile}`}>
          {kindStyle.icon}
        </div>

        {/* name + meta */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-100" title={item.path}>
            {item.name}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>{formatSize(item.size)}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${kindStyle.badge}`}>
              {item.kind ?? "unknown"}
            </span>
          </div>
        </div>

        {/* target select */}
        <div className="flex shrink-0 items-center gap-2">
          <TransformIcon className="hidden h-4 w-4 text-[#69dfcb] sm:inline" />
          <select
            value={item.target}
            disabled={disabled}
            onChange={(e) => onTargetChange(item.id, e.target.value)}
            className="select-dark rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-slate-100 outline-none transition focus:border-[#69dfcb]/60 focus:ring-2 focus:ring-[#69dfcb]/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
                {t.hint ? ` · ${t.hint}` : ""}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => onRemove(item.id)}
            disabled={disabled}
            aria-label="Remove file"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
          <div className="hidden items-center gap-1 sm:flex">
            <button
              type="button"
              onClick={() => onMove(item.id, "up")}
              disabled={disabled || index === 0}
              aria-label="Move file up"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-white/[0.06] hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-25"
            >
              <ArrowUpIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onMove(item.id, "down")}
              disabled={disabled || index === total - 1}
              aria-label="Move file down"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition hover:bg-white/[0.06] hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-25"
            >
              <ArrowDownIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* status row */}
      <div className="flex items-center gap-3 pl-0 sm:pl-14">
        {item.status === "idle" && item.target === "removebg" && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fuchsia-300">
            <WandIcon className="h-3.5 w-3.5" /> Background will be removed → transparent PNG
          </span>
        )}

        {item.status === "idle" && item.target === "ascii" && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-300">
            <AsciiIcon className="h-3.5 w-3.5" /> Photo → text art (.txt), opens in any editor
          </span>
        )}

        {item.status === "idle" && item.target !== "removebg" && item.target !== "ascii" && (
          <span className="text-xs text-slate-500">Ready to convert</span>
        )}

        {item.status === "queued" && (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <SpinnerIcon className="h-3.5 w-3.5" /> Waiting in queue…
          </span>
        )}

        {item.status === "running" && (
          <div className="flex w-full flex-col gap-1.5">
            <div className="progress-track h-2 w-full">
              <div className="progress-fill" style={{ width: `${Math.max(4, item.percent)}%` }} />
            </div>
            <span className="text-[11px] text-slate-400">
              {item.stage ?? "Converting…"} · {item.percent}%
            </span>
          </div>
        )}

        {done && (
          <div className="flex w-full items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300">
              <CheckIcon className="h-4 w-4" /> Converted
              {item.outputs?.length ? (
                <span className="text-slate-500">· {item.outputs.length} file{item.outputs.length > 1 ? "s" : ""}</span>
              ) : null}
            </span>
            {item.outputs?.[0] && (
              <button
                type="button"
                onClick={() => onReveal(item.outputs![0])}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-300"
              >
                <ExternalIcon className="h-3.5 w-3.5" /> Open folder
              </button>
            )}
          </div>
        )}

        {item.status === "error" && (
          <div className="flex w-full items-center gap-2 text-xs text-rose-300">
            <AlertIcon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate" title={item.error}>
              {item.error ?? "Conversion failed"}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onTargetChange(item.id, item.target)}
              className="ml-auto shrink-0 rounded-lg border border-rose-300/20 px-2 py-1 text-[11px] font-medium text-rose-200 transition hover:border-rose-300/45 hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Retry
            </button>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
