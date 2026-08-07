"use client";

import type { ToastItem } from "./Converter";
import { AlertIcon, CheckIcon, XIcon } from "./icons";

const STYLES = {
  success: { border: "border-emerald-400/25", text: "text-emerald-300", icon: <CheckIcon className="h-4 w-4" /> },
  error: { border: "border-rose-400/25", text: "text-rose-300", icon: <AlertIcon className="h-4 w-4" /> },
  info: { border: "border-cyan-400/25", text: "text-cyan-300", icon: <XIcon className="h-4 w-4 rotate-45" /> },
} as const;

export default function Toasts({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => {
        const s = STYLES[t.type];
        return (
          <div
            key={t.id}
            className={`animate-toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-ink-900/95 px-4 py-3 text-sm shadow-2xl shadow-black/50 backdrop-blur ${s.border}`}
          >
            <span className={`mt-0.5 shrink-0 ${s.text}`}>{s.icon}</span>
            <span className="min-w-0 break-words text-slate-200">{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
