"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api, isElectron } from "@/lib/electron-api";
import { defaultTargetFor, extOf, kindOf, targetsFor } from "@/shared/formats";
import type { FileKind } from "@/shared/formats";

import Dropzone, { AddedFile } from "./Dropzone";
import FileCard from "./FileCard";
import FileViewer from "./FileViewer";
import Toolbar from "./Toolbar";
import Toasts from "./Toasts";
import { Header } from "./Header";
import {
  AlertIcon,
  AsciiIcon,
  AudioIcon,
  BoxIcon,
  DocIcon,
  FolderIcon,
  ImageIcon,
  ShieldIcon,
  VideoIcon,
  WandIcon,
} from "./icons";

type Status = "idle" | "queued" | "running" | "done" | "error";

export interface FileItem {
  id: string;
  path: string;
  name: string;
  size: number;
  ext: string;
  kind: FileKind | null;
  target: string;
  status: Status;
  percent: number;
  stage?: string;
  error?: string;
  outputs?: string[];
  color?: string | null;
  imageOptions?: { width?: number; height?: number; rotate?: number };
}

export interface ToastItem {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

function getConcurrency(): number {
  // Heuristic: 1 worker per 3 logical cores, clamped 2–4.
  // Keeps UI responsive on low-end, uses more cores on workstations.
  // Allow override via window.L2L_CONCURRENCY for power users / tests.
  try {
    const override = (typeof window !== "undefined" && (window as unknown as Record<string, unknown>).L2L_CONCURRENCY) as unknown;
    if (typeof override === "number" && override >= 1 && override <= 8) return Math.round(override);
  } catch { /* ignore */ }
  const cores = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 4) : 4;
  if (cores <= 2) return 2;
  if (cores <= 6) return 2;
  if (cores <= 10) return 3;
  return 4;
}
const CONCURRENCY_FALLBACK = 2;
// Quality is always max — the app auto-picks the best encoder settings,
// no user setting required (per product decision).
const BEST_QUALITY = "lossless" as const;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// Showcase tiles — clickable. Picking a special tile (ASCII / Remove BG)
// pre-selects that conversion for photos you drop afterwards.
// ---------------------------------------------------------------------------
interface ShowcaseEntry {
  id: string;
  icon: React.ReactNode;
  label: string;
  desc: string;
  formats: string[];
  accent: string; // icon + active text color
  ring: string; // active tile border/bg
  chip: string; // format chip colors
}

const SHOWCASE: ShowcaseEntry[] = [
  {
    id: "image",
    icon: <ImageIcon className="h-5 w-5" />,
    label: "Images",
    desc: "Convert between PNG, JPG, WebP, GIF, AVIF and TIFF — or turn any photo into a PDF.",
    formats: ["PNG", "JPG", "WebP", "GIF", "AVIF", "TIFF", "PDF"],
    accent: "text-emerald-300",
    ring: "border-emerald-400/60 bg-emerald-500/10",
    chip: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200",
  },
  {
    id: "video",
    icon: <VideoIcon className="h-5 w-5" />,
    label: "Video",
    desc: "Repackage or re-encode video between MP4, WebM, MKV, MOV, AVI, MPEG, OGV and GIF.",
    formats: ["MP4", "WebM", "MKV", "MOV", "AVI", "MPEG", "OGV", "GIF"],
    accent: "text-rose-300",
    ring: "border-rose-400/60 bg-rose-500/10",
    chip: "border-rose-400/25 bg-rose-500/10 text-rose-200",
  },
  {
    id: "audio",
    icon: <AudioIcon className="h-5 w-5" />,
    label: "Audio",
    desc: "Transcode audio between MP3, WAV, FLAC, OGG, M4A, AAC, OPUS, AIFF and AC3.",
    formats: ["MP3", "WAV", "FLAC", "OGG", "M4A", "AAC", "OPUS", "AIFF"],
    accent: "text-amber-300",
    ring: "border-amber-400/60 bg-amber-500/10",
    chip: "border-amber-400/25 bg-amber-500/10 text-amber-200",
  },
  {
    id: "document",
    icon: <DocIcon className="h-5 w-5" />,
    label: "Documents",
    desc: "PDF, DOCX, TXT, Markdown, HTML, CSV and XLSX — pages to images, text extraction and more.",
    formats: ["PDF", "DOCX", "TXT", "MD", "HTML", "CSV", "XLSX"],
    accent: "text-sky-300",
    ring: "border-sky-400/60 bg-sky-500/10",
    chip: "border-sky-400/25 bg-sky-500/10 text-sky-200",
  },
  {
    id: "model",
    icon: <BoxIcon className="h-5 w-5" />,
    label: "3D Models",
    desc: "Convert meshes between STL, OBJ, PLY, 3MF and GLB — right on your device.",
    formats: ["STL", "OBJ", "PLY", "3MF", "GLB"],
    accent: "text-orange-300",
    ring: "border-orange-400/60 bg-orange-500/10",
    chip: "border-orange-400/25 bg-orange-500/10 text-orange-200",
  },
  {
    id: "removebg",
    icon: <WandIcon className="h-5 w-5" />,
    label: "Remove BG",
    desc: "One-click background removal. The subject stays, the background turns transparent — fully on-device.",
    formats: ["Photo → transparent PNG"],
    accent: "text-fuchsia-300",
    ring: "border-fuchsia-400/60 bg-fuchsia-500/10",
    chip: "border-fuchsia-400/25 bg-fuchsia-500/10 text-fuchsia-200",
  },
  {
    id: "ascii",
    icon: <AsciiIcon className="h-5 w-5" />,
    label: "ASCII Art",
    desc: "Turn any photo into monospace text art (.txt). Great for terminals, code comments and retro posters.",
    formats: ["Photo → .txt art"],
    accent: "text-cyan-300",
    ring: "border-cyan-400/60 bg-cyan-500/10",
    chip: "border-cyan-400/25 bg-cyan-500/10 text-cyan-200",
  },
];

/** Special tiles that pre-select a conversion target for dropped photos. */
const FEATURE_TARGETS: Record<string, string> = {
  removebg: "removebg",
  ascii: "ascii",
};

interface HistoryEntry { at: string; name: string; target: string; outputs: string[]; }

export default function Converter() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [outputMode, setOutputMode] = useState<"source" | "folder">("source");
  const [outputFolder, setOutputFolder] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [activeShowcase, setActiveShowcase] = useState<string | null>(null);
  const [viewerFile, setViewerFile] = useState<FileItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterKind, setFilterKind] = useState<FileKind | "all">("all");
  const [search, setSearch] = useState("");
  const dragIdxRef = useRef<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [folderHistory, setFolderHistory] = useState<string[]>([]);

  const filesRef = useRef(files);
  const runningRef = useRef(false);
  const activeRef = useRef(activeShowcase);
  const convertAllRef = useRef<() => Promise<void>>(async () => {});
  // A conversion pool takes a snapshot of its queue. Keep cancellation state
  // outside React state so a queued item can be skipped before its worker starts.
  const cancelledIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(() => {
    activeRef.current = activeShowcase;
  }, [activeShowcase]);

  useEffect(() => {
    if (!api) return;
    void api.getPreference("outputFolder").then((savedFolder) => {
      if (savedFolder) setOutputFolder(savedFolder);
    });
    // load history from localStorage (renderer-only)
    try {
      const raw = localStorage.getItem("l2l:history");
      if (raw) setHistory(JSON.parse(raw));
      const rawFolders = localStorage.getItem("l2l:folderHistory");
      if (rawFolders) setFolderHistory(JSON.parse(rawFolders));
    } catch { /* ignore */ }
  }, []);

  // ---- toasts ----
  const toast = useCallback((type: ToastItem["type"], message: string) => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, type, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  // ---- live progress from the backend ----
  useEffect(() => {
    if (!api) return;
    return api.onProgress((e) => {
      setFiles((fs) =>
        fs.map((f) =>
          f.id === e.id
            ? { ...f, percent: Math.min(100, Math.round(e.percent)), stage: e.stage }
            : f,
        ),
      );
    });
  }, []);

  // ---- add files ----
  const addFiles = useCallback(
    (entries: AddedFile[]) => {
      // An active special tile pre-selects its target for compatible photos.
      const prefer = FEATURE_TARGETS[activeRef.current ?? ""] ?? null;
      setFiles((fs) => {
        const existing = new Set(fs.map((f) => f.path));
        const news: FileItem[] = [];
        for (const e of entries) {
          if (existing.has(e.path)) continue;
          existing.add(e.path);
          const ext = extOf(e.path);
          const kind = kindOf(ext);
          const isPhoto = kind === "image";
          news.push({
            id: crypto.randomUUID(),
            path: e.path,
            name: e.path.split(/[\\/]/).pop() ?? e.path,
            size: e.size,
            ext,
            kind,
            target: isPhoto && prefer ? prefer : defaultTargetFor(ext) ?? "",
            status: "idle",
            percent: 0,
          });
        }
        return [...fs, ...news];
      });
      if (entries.length) {
        const photos = entries.filter((e) => kindOf(extOf(e.path)) === "image").length;
        toast("info", prefer && photos > 0 ? `${photos} photo(s) added — target: ${prefer}` : `${entries.length} file(s) added`);
      }
    },
    [toast],
  );

  // ---- browse (shared by the dropzone and the showcase CTA) ----
  const browse = useCallback(async () => {
    if (!api) return;
    const entries = await api.selectFiles();
    if (entries.length) addFiles(entries);
  }, [addFiles]);

  // ---- file actions ----
  const removeFile = useCallback((id: string) => {
    setFiles((fs) => fs.filter((f) => f.id !== id));
  }, []);

  const setTarget = useCallback((id: string, target: string) => {
    setFiles((fs) =>
      fs.map((f) =>
        f.id === id
          ? { ...f, target, status: "idle" as Status, percent: 0, error: undefined, outputs: undefined }
          : f,
      ),
    );
  }, []);

  const setColor = useCallback((id: string, color: string | null) => {
    setFiles((fs) =>
      fs.map((f) => (f.id === id ? { ...f, color } : f)),
    );
  }, []);

  const setImageOptions = useCallback((id: string, opts: { width?: number; height?: number; rotate?: number }) => {
    setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, imageOptions: { ...(f.imageOptions ?? {}), ...opts } } : f)));
  }, []);

  const clearImageOptions = useCallback((id: string) => {
    setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, imageOptions: undefined } : f)));
  }, []);

  const retryFile = useCallback((id: string) => {
    cancelledIdsRef.current.delete(id);
    setFiles((fs) =>
      fs.map((f) =>
        f.id === id ? { ...f, status: "idle" as Status, percent: 0, error: undefined, stage: undefined } : f,
      ),
    );
    setTimeout(() => void convertAllRef.current(), 0);
  }, []);

  const cancelFile = useCallback((id: string) => {
    cancelledIdsRef.current.add(id);
    void api?.cancelConvert(id);
    setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, status: "error" as Status, error: "Cancelled", stage: "Cancelled", percent: 0 } : f)));
  }, []);

  const cancelAll = useCallback(() => {
    for (const f of filesRef.current.filter((f) => f.status === "running" || f.status === "queued")) {
      cancelledIdsRef.current.add(f.id);
      void api?.cancelConvert(f.id);
    }
    setFiles((fs) => fs.map((f) => (f.status === "running" || f.status === "queued" ? { ...f, status: "error" as Status, error: "Cancelled", stage: "Cancelled", percent: 0 } : f)));
  }, []);

  const openViewer = useCallback((id: string) => {
    const found = filesRef.current.find((f) => f.id === id);
    if (found) setViewerFile(found);
  }, []);

  const clearCompleted = useCallback(() => {
    setFiles((fs) => fs.filter((f) => f.status !== "done"));
  }, []);

  const moveFile = useCallback((id: string, direction: "up" | "down") => {
    setFiles((fs) => {
      const from = fs.findIndex((f) => f.id === id);
      const to = direction === "up" ? from - 1 : from + 1;
      if (from < 0 || to < 0 || to >= fs.length) return fs;
      const next = [...fs];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }, []);

  const reorder = useCallback((from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setFiles((fs) => {
      if (from >= fs.length || to >= fs.length) return fs;
      const next = [...fs];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    // compute visible ids inline to avoid dep on filteredFiles defined later
    setFiles((fs) => fs); // noop to keep deps simple, then compute via filesRef
    const all = filesRef.current;
    const visible = all.filter((f) => {
      const matchKind = filterKind === "all" || f.kind === filterKind;
      const matchSearch = !search || f.name.toLowerCase().includes(search.toLowerCase());
      return matchKind && matchSearch;
    });
    const visibleIds = visible.map((f) => f.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [filterKind, search, selectedIds]);

  const bulkSetTarget = useCallback((target: string) => {
    if (selectedIds.size === 0) return;
    setFiles((fs) =>
      fs.map((f) => {
        if (!selectedIds.has(f.id)) return f;
        const allowed = targetsFor(f.ext).map((t) => t.id);
        if (!allowed.includes(target)) return f;
        return { ...f, target, status: "idle" as Status, percent: 0, error: undefined, outputs: undefined, stage: undefined };
      }),
    );
    toast("info", `Target → ${target.toUpperCase()} for ${selectedIds.size} file(s)`);
  }, [selectedIds, toast]);

  const bulkRemove = useCallback(() => {
    if (selectedIds.size === 0) return;
    setFiles((fs) => fs.filter((f) => !selectedIds.has(f.id)));
    setSelectedIds(new Set());
    toast("info", "Selected files removed");
  }, [selectedIds, toast]);

  const bulkRetry = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    ids.forEach((id) => cancelledIdsRef.current.delete(id));
    setFiles((fs) => fs.map((f) => (ids.includes(f.id) ? { ...f, status: "idle" as Status, percent: 0, error: undefined, stage: undefined } : f)));
    setTimeout(() => void convertAllRef.current(), 0);
  }, [selectedIds]);

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && files.length > 0) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        toggleSelectAll();
      }
      if (e.key === "Delete" && selectedIds.size > 0 && !running) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        bulkRemove();
      }
      if (e.key === "Escape") {
        if (viewerFile) setViewerFile(null);
        else if (selectedIds.size > 0) setSelectedIds(new Set());
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [files.length, selectedIds, running, viewerFile, toggleSelectAll, bulkRemove]);

  // ---- batch conversion (bounded pool) ----
  const convertAll = useCallback(async () => {
    if (!api || runningRef.current) return;
    const queue = filesRef.current.filter((f) => f.status === "idle" || f.status === "error");
    if (queue.length === 0) return;
    // Retrying a prior cancellation creates a fresh job.
    queue.forEach((item) => cancelledIdsRef.current.delete(item.id));

    runningRef.current = true;
    setRunning(true);
    setFiles((fs) =>
      fs.map((f) =>
        queue.some((q) => q.id === f.id)
          ? { ...f, status: "queued" as Status, percent: 0, error: undefined, stage: undefined }
          : f,
      ),
    );

    const outputDir =
      outputMode === "folder" && outputFolder ? outputFolder : undefined;

    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const item = queue[cursor++];
        if (cancelledIdsRef.current.has(item.id)) continue;
        setFiles((fs) =>
          fs.map((f) => (f.id === item.id ? { ...f, status: "running" as Status } : f)),
        );
        let res;
        try {
          res = await api!.convert({
            id: item.id,
            inputPath: item.path,
            target: item.target,
            quality: BEST_QUALITY,
            outputDir,
            color: item.color ?? undefined,
            imageOptions: item.imageOptions,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFiles((fs) =>
            fs.map((f) =>
              f.id === item.id
                ? { ...f, status: "error" as Status, percent: 0, error: message }
                : f,
            ),
          );
          toast("error", `${item.name}: ${message}`);
          continue;
        }
        if (res.ok) {
          setFiles((fs) =>
            fs.map((f) =>
              f.id === item.id
                ? { ...f, status: "done" as Status, percent: 100, stage: "Done", outputs: res.outputs }
                : f,
            ),
          );
          toast("success", `Converted ${item.name}`);
          // persist history
          try {
            const entry: HistoryEntry = { at: new Date().toISOString(), name: item.name, target: item.target, outputs: res.outputs ?? [] };
            setHistory((h) => {
              const next = [entry, ...h].slice(0, 20);
              localStorage.setItem("l2l:history", JSON.stringify(next));
              return next;
            });
          } catch { /* ignore */ }
        } else {
          setFiles((fs) =>
            fs.map((f) =>
              f.id === item.id
                ? { ...f, status: "error" as Status, percent: 0, error: res.error ?? "Conversion failed" }
                : f,
            ),
          );
          toast("error", `${item.name}: ${res.error ?? "Conversion failed"}`);
        }
      }
    };

    try {
      const concurrency = Math.min(getConcurrency() || CONCURRENCY_FALLBACK, queue.length);
      const workers = Array.from({ length: concurrency }, worker);
      await Promise.all(workers);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast("error", `The conversion queue stopped: ${message}`);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [outputMode, outputFolder, toast]);
  // Retry callbacks are intentionally stable; keep their conversion entry
  // point current so they honour a newly selected output folder or mode.
  convertAllRef.current = convertAll;

  // ---- derived filtered view ----
  const filteredFiles = files.filter((f) => {
    const matchKind = filterKind === "all" || f.kind === filterKind;
    const matchSearch = !search || f.name.toLowerCase().includes(search.toLowerCase());
    return matchKind && matchSearch;
  });

  // ---- render ----
  const doneCount = files.filter((f) => f.status === "done").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const activeCard = SHOWCASE.find((c) => c.id === activeShowcase) ?? null;
  const bulkCommonTargets = (() => {
    if (selectedIds.size === 0) return [];
    const selected = files.filter((f) => selectedIds.has(f.id));
    if (selected.length === 0) return [];
    const sets = selected.map((f) => new Set(targetsFor(f.ext).map((t) => t.id)));
    const first = Array.from(sets[0]);
    return first.filter((t) => sets.every((s) => s.has(t)));
  })();

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden">
      {/* restrained ambient texture */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="bg-grid absolute inset-0" />
      </div>

      <Header />

      <main className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col gap-5 overflow-y-auto px-5 pb-8 pt-7 sm:px-8 lg:px-10 lg:pt-10">
        {!isElectron && (
          <div className="animate-slide-up flex items-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            <AlertIcon className="h-5 w-5 shrink-0" />
            <span>
              This preview is running in a browser. Launch the desktop app with{" "}
              <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs">npm start</code>{" "}
              to convert files.
            </span>
          </div>
        )}

        {files.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col gap-8">
            {/* dropzone fills the vertical space (no empty bottom), the
                compact showcase strip sits below it */}
            <div className="flex min-h-0 flex-[1.15] items-stretch">
              <Dropzone onAdd={addFiles} onBrowse={browse} />
            </div>

            {/* compact, clickable format showcase */}
            <section className="animate-slide-up" style={{ animationDelay: "110ms" }}>
                  <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="eyebrow">
                  What can I convert?
                </p>
                <p className="text-[11px] text-slate-600">
                  Choose a workflow to make it the default for compatible files.
                </p>
              </div>

              <div className="grid grid-cols-4 gap-2.5 lg:grid-cols-7">
                {SHOWCASE.map((c) => {
                  const isActive = activeShowcase === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => setActiveShowcase(isActive ? null : c.id)}
                      className={`group flex flex-col items-center gap-2 rounded-2xl border p-3.5 text-center transition-all duration-200 hover:-translate-y-0.5 ${
                        isActive
                        ? `${c.ring} shadow-lg shadow-black/30`
                          : "glass hover:border-white/20 hover:bg-white/[0.05]"
                      }`}
                    >
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110 ${c.accent}`}
                      >
                        {c.icon}
                      </span>
                      <span className="text-xs font-semibold text-slate-200">{c.label}</span>
                      <span
                        className={`h-0.5 w-0 rounded-full transition-all duration-300 ${
                          isActive ? "w-5 bg-current opacity-70" : "opacity-0"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>

              {activeCard && (
                <div className="glass animate-slide-up mt-3 flex flex-wrap items-center gap-4 rounded-2xl p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={activeCard.accent}>{activeCard.icon}</span>
                      <p className="text-sm font-semibold text-slate-100">{activeCard.label}</p>
                      {FEATURE_TARGETS[activeCard.id] && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                          <ShieldIcon className="h-3 w-3" /> fully local
                        </span>
                      )}
                    </div>
                    <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-400">
                      {activeCard.desc}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {activeCard.formats.map((f) => (
                        <span
                          key={f}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${activeCard.chip}`}
                        >
                          {f}
                        </span>
                      ))}
                      {FEATURE_TARGETS[activeCard.id] && (
                        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-400">
                          Photos you drop now default to this
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void browse()}
                    disabled={!isElectron}
                    className="btn-primary inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-white"
                  >
                    <FolderIcon className="h-3.5 w-3.5" />
                    Browse files
                  </button>
                </div>
              )}
            </section>
          </div>
        ) : (
          <>
            <Dropzone compact onAdd={addFiles} onBrowse={browse} />

            <Toolbar
              files={files}
              running={running}
              outputMode={outputMode}
              onOutputMode={setOutputMode}
              outputFolder={outputFolder}
              onPickFolder={async () => {
                if (!api) return;
                const folder = await api.selectOutputFolder();
                if (folder) {
                  setOutputFolder(folder);
                  void api.setPreference("outputFolder", folder);
                  try {
                    setFolderHistory((prev) => {
                      const next = [folder, ...prev.filter((p) => p !== folder)].slice(0, 5);
                      localStorage.setItem("l2l:folderHistory", JSON.stringify(next));
                      return next;
                    });
                  } catch { /* ignore */ }
                }
              }}
              onForgetFolder={() => {
                setOutputFolder(null);
                void api?.setPreference("outputFolder", null);
                toast("info", "Saved output folder forgotten");
              }}
              onConvert={() => void convertAll()}
              onRetryFailed={() => void convertAll()}
              onClearCompleted={clearCompleted}
            />
            {running && (
              <div className="flex justify-end">
                <button type="button" onClick={cancelAll} className="rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-400/15">Cancel all running</button>
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-5 lg:flex-row">
              {/* file queue */}
              <div className="min-w-0 flex-1 space-y-3 overflow-y-auto pb-1 pr-1">
                {/* search + filter + select-all */}
                <div className="panel-shell">
                  <div className="panel-core flex flex-wrap items-center gap-2 p-2">
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                      <input type="checkbox" checked={filteredFiles.length > 0 && filteredFiles.every((f) => selectedIds.has(f.id))} onChange={toggleSelectAll} className="h-4 w-4 rounded border-white/20 bg-transparent accent-[#69dfcb]" />
                      Select all ({filteredFiles.length})
                    </label>
                    <div className="h-4 w-px bg-white/10" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files…" className="min-w-[140px] flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 outline-none focus:border-[#69dfcb]/40" />
                    <select value={filterKind} onChange={(e) => setFilterKind(e.target.value as FileKind | "all")} className="select-dark rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200">
                      <option value="all">All kinds</option>
                      <option value="image">Images</option>
                      <option value="video">Video</option>
                      <option value="audio">Audio</option>
                      <option value="document">Docs</option>
                      <option value="model">3D</option>
                    </select>
                    {selectedIds.size > 0 && <span className="text-xs text-[#69dfcb]">{selectedIds.size} selected</span>}
                    {search || filterKind !== "all" ? <button type="button" onClick={() => { setSearch(""); setFilterKind("all"); }} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 hover:text-slate-200">Clear filter</button> : null}
                  </div>
                </div>

                {/* bulk bar */}
                {selectedIds.size > 0 && (
                  <div className="panel-shell border-[#69dfcb]/30">
                    <div className="panel-core flex flex-wrap items-center gap-2 p-2">
                      <span className="text-xs font-semibold text-slate-200">Bulk:</span>
                      <select defaultValue="" onChange={(e) => { if (e.target.value) { bulkSetTarget(e.target.value); e.target.value = ""; } }} className="select-dark rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200">
                        <option value="" disabled>Change target…</option>
                        {bulkCommonTargets.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                        {bulkCommonTargets.length === 0 && <option disabled>No common target</option>}
                      </select>
                      <button type="button" onClick={bulkRetry} disabled={running} className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-1.5 text-xs text-amber-200 hover:bg-amber-400/15 disabled:opacity-40">Retry selected</button>
                      <button type="button" onClick={bulkRemove} disabled={running} className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-2.5 py-1.5 text-xs text-rose-200 hover:bg-rose-400/15 disabled:opacity-40">Remove selected</button>
                      <button type="button" onClick={() => setSelectedIds(new Set())} className="ml-auto rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-400">Clear selection</button>
                    </div>
                  </div>
                )}

                {filteredFiles.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center text-xs text-slate-500">No files match filter.</div>
                ) : filteredFiles.map((f) => {
                  const realIdx = files.findIndex((x) => x.id === f.id);
                  return (
                  <div
                    key={f.id}
                    draggable={!running}
                    onDragStart={() => { dragIdxRef.current = realIdx; }}
                    onDragOver={(e) => { e.preventDefault(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = dragIdxRef.current;
                      if (from == null) return;
                      reorder(from, realIdx);
                      dragIdxRef.current = null;
                    }}
                    className={`${selectedIds.has(f.id) ? "ring-1 ring-[#69dfcb]/40 rounded-2xl" : ""}`}
                  >
                  <FileCard
                    item={f}
                    index={realIdx}
                    total={files.length}
                    disabled={running && f.status !== "running" && f.status !== "queued"}
                    selected={selectedIds.has(f.id)}
                    onToggleSelect={toggleSelect}
                    onRemove={removeFile}
                    onTargetChange={setTarget}
                    onRetry={retryFile}
                    onCancel={cancelFile}
                    onReveal={(p) => api?.revealFile(p)}
                    onMove={moveFile}
                    onColorChange={setColor}
                    onImageOptions={setImageOptions}
                    onClearImageOptions={clearImageOptions}
                    onView={openViewer}
                  />
                  </div>
                  );
                })}
              </div>

              {/* file viewer panel */}
              <FileViewer
                item={viewerFile}
                onClose={() => setViewerFile(null)}
              />

              {/* session summary sidebar */}
              <aside className="panel-shell hidden w-64 shrink-0 self-start lg:flex">
                <div className="panel-core flex w-full flex-col gap-4 p-5">
                <p className="eyebrow">
                  Session
                </p>
                <div className="space-y-3">
                  <Stat label="Total files" value={String(files.length)} />
                  <Stat label="Converted" value={String(doneCount)} accent="text-emerald-300" />
                  <Stat
                    label="Remaining"
                    value={String(files.length - doneCount - errorCount)}
                    accent="text-cyan-300"
                  />
                  {errorCount > 0 && (
                    <Stat label="Failed" value={String(errorCount)} accent="text-rose-300" />
                  )}
                  <Stat
                    label="Total size"
                    value={formatSize(files.reduce((s, f) => s + f.size, 0))}
                  />
                </div>
                <div className="mt-auto flex items-center gap-1.5 border-t border-white/5 pt-3 text-[11px] text-slate-500">
                  <ShieldIcon className="h-3.5 w-3.5 text-emerald-400/70" />
                  Originals are never modified
                </div>
                {folderHistory.length > 0 && (
                  <div className="border-t border-white/5 pt-3">
                    <p className="eyebrow mb-2">Recent folders</p>
                    <div className="space-y-1">
                      {folderHistory.map((p) => (
                        <button key={p} type="button" onClick={() => { setOutputFolder(p); setOutputMode("folder"); void api?.setPreference("outputFolder", p); }} className="block w-full truncate rounded bg-white/[0.03] px-2 py-1 text-left text-[11px] text-slate-400 hover:text-slate-200" title={p}>{p}</button>
                      ))}
                    </div>
                  </div>
                )}
                {history.length > 0 && (
                  <div className="border-t border-white/5 pt-3">
                    <div className="flex items-center justify-between">
                      <p className="eyebrow">History</p>
                      <button type="button" onClick={() => { setHistory([]); try{localStorage.removeItem("l2l:history");}catch{} }} className="text-[11px] text-slate-500 hover:text-slate-300">Clear</button>
                    </div>
                    <div className="mt-2 max-h-40 space-y-1 overflow-auto pr-1">
                      {history.map((h, i) => (
                        <div key={i} className="rounded bg-white/[0.03] px-2 py-1.5">
                          <p className="truncate text-[11px] font-medium text-slate-300">{h.name} → {h.target.toUpperCase()}</p>
                          <p className="text-[10px] text-slate-500">{new Date(h.at).toLocaleTimeString()} · {h.outputs.length} file(s)</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                </div>
              </aside>
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                {files.length} file(s) · {doneCount} done
                {errorCount > 0 ? ` · ${errorCount} failed` : ""}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
                Best quality — always
              </span>
            </footer>
          </>
        )}
      </main>

      <Toasts toasts={toasts} />
    </div>
  );
}

function Stat({ label, value, accent = "text-slate-100" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${accent}`}>{value}</span>
    </div>
  );
}
