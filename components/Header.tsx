"use client";

import { isElectron } from "@/lib/electron-api";
import { LockIcon, TransformIcon } from "./icons";

export function Header() {
  return (
    <header className="animate-fade-in mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-4 px-5 pt-5 sm:px-8 lg:px-10 lg:pt-7">
      <img
        src="/icon.png"
        alt="L2L logo"
        className="h-11 w-11 shrink-0 rounded-[0.9rem] shadow-[0_14px_32px_-18px_rgba(105,223,203,0.85)] transition-transform duration-300 hover:scale-105"
      />

      <div className="min-w-0 flex-1">
        <h1 className="text-[1.05rem] font-semibold tracking-[-0.03em] text-slate-100">
          L2L <span className="text-[#69dfcb]">Converter</span>
        </h1>
        <p className="truncate text-xs text-slate-500 sm:text-sm">
          Move files between formats, privately and locally.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#69dfcb]/20 bg-[#69dfcb]/[0.07] px-3 py-1.5 text-[11px] font-medium text-[#a9f2e5]">
          <LockIcon className="h-3.5 w-3.5" />
          Local by design
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium ${
            isElectron
              ? "border-[#69dfcb]/20 bg-[#69dfcb]/[0.07] text-[#a9f2e5]"
              : "border-amber-400/20 bg-amber-400/10 text-amber-300"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isElectron ? "animate-pulse-slow bg-[#69dfcb]" : "bg-amber-400"}`} />
          {isElectron ? "Desktop mode" : "Browser mode"}
        </span>
        <span className="hidden items-center gap-1.5 text-[11px] text-slate-600 xl:inline-flex">
          <TransformIcon className="h-3.5 w-3.5" />
          transformation workspace
        </span>
      </div>
    </header>
  );
}
