"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/electron-api";
import type { FileItem } from "./Converter";
import { XIcon } from "./icons";

interface Props {
  item: FileItem | null;
  onClose: () => void;
}

function getExt(p: string): string {
  return p.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
}

function isTextFile(ext: string): boolean {
  return ["txt", "md", "csv", "json", "xml", "js", "ts", "css", "svg", "log", "ini", "cfg", "yaml", "yml", "toml", "sh", "py", "rb", "go", "rs", "java", "c", "cpp", "h"].includes(ext);
}

function isImageFile(ext: string): boolean {
  return ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "tif", "avif", "heic", "heif"].includes(ext);
}

function isPdfFile(ext: string): boolean {
  return ext === "pdf";
}

function isVideoFile(ext: string): boolean {
  return ["mp4", "webm", "mkv", "mov", "avi", "mpeg", "mpg", "ogv", "flv", "3gp", "m4v", "wmv", "3gpp"].includes(ext);
}

function isAudioFile(ext: string): boolean {
  return ["mp3", "wav", "flac", "ogg", "oga", "m4a", "aac", "wma", "opus", "aiff", "aif", "ac3", "amr"].includes(ext);
}

function isHtmlFile(ext: string): boolean {
  return ["html", "htm"].includes(ext);
}

function isModelFile(ext: string): boolean {
  return ["stl", "obj", "ply", "3mf", "glb"].includes(ext);
}

function isSpreadsheetFile(ext: string): boolean {
  return ["xlsx", "xls"].includes(ext);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Convert base64 string to a blob URL — chunked to avoid stack blowup on large files. */
function base64ToBlobUrl(base64: string, mime: string): string {
  // Use native base64 → Blob path: decode in chunks to avoid large intermediate strings
  const CHUNK = 8192;
  const len = base64.length;
  // Fast path for small files (<2 MB base64)
  if (len < 2 * 1024 * 1024) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  }
  // Chunked path: decode slice-by-slice and collect Uint8Arrays
  const parts: Uint8Array[] = [];
  for (let i = 0; i < len; i += CHUNK) {
    const slice = base64.slice(i, i + CHUNK);
    // Pad slice to multiple of 4 for atob
    const padded = slice.length % 4 ? slice + "=".repeat(4 - (slice.length % 4)) : slice;
    try {
      const bin = atob(padded);
      const arr = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
      parts.push(arr);
    } catch {
      // Skip malformed chunk (should not happen)
    }
  }
  return URL.createObjectURL(new Blob(parts as BlobPart[], { type: mime }));
}

const LARGE_PREVIEW_THRESHOLD = 30 * 1024 * 1024; // warn/skip inline preview above 30 MB
const TEXT_PREVIEW_LIMIT = 500_000; // truncate text preview at 500k chars

function FileTypeIcon({ ext }: { ext: string }) {
  if (isImageFile(ext)) {
    return (
      <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    );
  }
  if (isPdfFile(ext)) {
    return (
      <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M9 15h6" />
      </svg>
    );
  }
  if (isVideoFile(ext)) {
    return (
      <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="20" height="20" rx="2.18" />
        <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (isAudioFile(ext)) {
    return (
      <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    );
  }
  if (isModelFile(ext)) {
    return (
      <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    );
  }
  if (isSpreadsheetFile(ext)) {
    return (
      <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18" />
        <path d="M9 3v18" />
        <path d="M9 9l6 6M15 9l-6 6" opacity="0" />
      </svg>
    );
  }
  return (
    <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export default function FileViewer({ item, onClose }: Props) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobMime, setBlobMime] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelInfo, setModelInfo] = useState<{ vertices: number; triangles: number; ext: string } | null>(null);
  const [sheetPreview, setSheetPreview] = useState<{ headers: string[]; rows: string[][]; sheetName: string } | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Revoke previous blob URL when it changes / unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  // Also revoke when blobUrl state is cleared (item change)
  useEffect(() => {
    if (!blobUrl && blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, [blobUrl]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && item) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [item, onClose]);

  // Load file content via IPC when item changes
  useEffect(() => {
    // Cleanup previous blob URL
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setTextContent(null);
    setBlobUrl(null);
    setBlobMime("");
    setModelInfo(null);
    setSheetPreview(null);
    setLoading(false);
    setError(null);

    if (!item?.outputs?.length || !api) return;

    const primaryOutput = item.outputs[0];
    if (!primaryOutput) return;

    const ext = getExt(primaryOutput);

    // 3D model → fetch model info (vertices/triangles)
    if (isModelFile(ext) && api.getModelInfo) {
      setLoading(true);
      api.getModelInfo(primaryOutput)
        .then((info) => {
          setModelInfo(info);
          setLoading(false);
        })
        .catch(() => setLoading(false));
      // Also try to load as base64 for potential future 3D canvas, but not required now
      return;
    }

    // Spreadsheet → fetch sheet preview
    if (isSpreadsheetFile(ext) && api.getSpreadsheetPreview) {
      setLoading(true);
      api.getSpreadsheetPreview(primaryOutput)
        .then((preview) => {
          setSheetPreview(preview);
          setLoading(false);
          if (!preview) setError("Spreadsheet is empty or could not be read.");
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
      return;
    }

    // Text-based files → read as UTF-8 text (with truncation)
    if (isTextFile(ext) && !isHtmlFile(ext)) {
      setLoading(true);
      api.readFileAsText(primaryOutput)
        .then((text) => {
          if (text.length > TEXT_PREVIEW_LIMIT) {
            setTextContent(text.slice(0, TEXT_PREVIEW_LIMIT) + "\n\n… truncated — full file is " + (text.length / 1000).toFixed(0) + "k chars. Open in folder to view completely.");
          } else {
            setTextContent(text);
          }
          setLoading(false);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });
      return;
    }

    // Guard: skip inline preview for huge outputs — show fallback instead
    // We check item.size as a hint; actual file may be larger (e.g. video transcode)
    // The main process also caps at 64 MB, so base64 will be empty for huge files.
    if (item.size > LARGE_PREVIEW_THRESHOLD) {
      setError(null);
      setLoading(false);
      // Don't fetch — keep blobUrl null so "No preview" fallback shows with size
      return;
    }

    // Everything else (images, pdf, video, audio, html) → read as base64 → blob URL
    setLoading(true);
    api.readFileAsBase64(primaryOutput)
      .then(({ base64, mime }) => {
        if (!base64) {
          // Main process may have refused due to size cap
          setError("Preview unavailable — file too large or could not be read. Use “Open in folder”.");
          setLoading(false);
          return;
        }
        const url = base64ToBlobUrl(base64, mime);
        blobUrlRef.current = url;
        setBlobUrl(url);
        setBlobMime(mime);

        // For text-like files (HTML), also load text content
        if (isHtmlFile(ext) && api) {
          return api.readFileAsText(primaryOutput).then((text) => {
            if (text.length > TEXT_PREVIEW_LIMIT) text = text.slice(0, TEXT_PREVIEW_LIMIT) + "\n… truncated";
            setTextContent(text);
            setLoading(false);
          }).catch(() => { setLoading(false); });
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [item]);

  const handleReveal = useCallback(() => {
    if (item?.outputs?.[0]) {
      api?.revealFile(item.outputs[0]);
    }
  }, [item]);

  const isOpen = item !== null;
  const primaryOutput = item?.outputs?.[0] ?? null;
  const outputName = primaryOutput?.split(/[\\/]/).pop() ?? "output";
  const ext = primaryOutput ? getExt(primaryOutput) : "";

  // Determine preview type
  const previewType: "text" | "image" | "pdf" | "video" | "audio" | "html" | "model" | "spreadsheet" | "none" =
    !primaryOutput ? "none"
    : isHtmlFile(ext) ? "html"
    : isTextFile(ext) ? "text"
    : isImageFile(ext) ? "image"
    : isPdfFile(ext) ? "pdf"
    : isVideoFile(ext) ? "video"
    : isAudioFile(ext) ? "audio"
    : isModelFile(ext) ? "model"
    : isSpreadsheetFile(ext) ? "spreadsheet"
    : "none";

  return (
    <>
      {/* Backdrop — only visible on small screens */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`flex h-full w-full max-w-2xl flex-col border-l border-white/10 bg-[#0c1218] shadow-2xl shadow-black/60 transition-all duration-300 ease-out lg:relative lg:w-[640px] lg:shrink-0 lg:rounded-2xl lg:border lg:border-white/10 lg:bg-[#0c1218]/90 ${
          isOpen
            ? "fixed right-0 top-0 z-50 lg:static"
            : "pointer-events-none fixed right-0 top-0 z-50 translate-x-full opacity-0 lg:hidden"
        }`}
      >
        {item && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-100 truncate">
                  {outputName}
                </p>
                {item.outputs && item.outputs.length > 1 && (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {item.outputs.length} output files
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/[0.08] hover:text-slate-200"
                aria-label="Close viewer"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Output files list */}
            {item.outputs && item.outputs.length > 0 && (
              <div className="border-b border-white/10 px-5 py-3">
                <p className="eyebrow mb-2">Output files</p>
                <div className="flex flex-wrap gap-1.5">
                  {item.outputs.map((p, i) => {
                    const name = p.split(/[\\/]/).pop() ?? p;
                    const fExt = getExt(p);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => api?.revealFile(p)}
                        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-left text-[11px] text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-300"
                      >
                        <span className="shrink-0 rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[8px] uppercase text-slate-500">{fExt}</span>
                        <span className="truncate max-w-[180px]">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Content area — takes remaining space, scrollable */}
            <div className="flex-1 overflow-auto p-5">
              {/* Loading */}
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-cyan-400" />
                  <span className="ml-3 text-sm text-slate-400">Loading…</span>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-4 text-xs text-rose-300">
                  {error}
                </div>
              )}

              {/* ===== TEXT PREVIEW ===== */}
              {!loading && !error && textContent != null && previewType === "text" && (
                <div className="rounded-xl border border-white/10 bg-black/30">
                  <div className="border-b border-white/5 px-4 py-2">
                    <p className="eyebrow">Text Preview</p>
                  </div>
                  <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-[12px] leading-relaxed text-slate-300">
                    {textContent}
                  </pre>
                </div>
              )}

              {/* ===== HTML PREVIEW ===== */}
              {!loading && !error && previewType === "html" && blobUrl && (
                <div className="rounded-xl border border-white/10 bg-black/30">
                  <div className="border-b border-white/5 px-4 py-2">
                    <p className="eyebrow">HTML Preview</p>
                  </div>
                  <div className="p-2">
                    <div className="overflow-hidden rounded-lg border border-white/10 bg-[#0d1117]">
                      <iframe
                        src={blobUrl}
                        className="h-[70vh] w-full border-0"
                        title="HTML preview"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ===== IMAGE PREVIEW ===== */}
              {!loading && !error && previewType === "image" && blobUrl && (
                <div className="rounded-xl border border-white/10 bg-black/30">
                  <div className="border-b border-white/5 px-4 py-2">
                    <p className="eyebrow">Image Preview</p>
                  </div>
                  <div className="flex items-center justify-center p-4">
                    <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg border border-white/10 bg-[#0d1117] p-2">
                      <img
                        src={blobUrl}
                        alt={outputName}
                        className="max-h-[68vh] max-w-full object-contain"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ===== PDF PREVIEW ===== */}
              {!loading && !error && previewType === "pdf" && blobUrl && (
                <div className="rounded-xl border border-white/10 bg-black/30">
                  <div className="border-b border-white/5 px-4 py-2">
                    <p className="eyebrow">PDF Preview</p>
                  </div>
                  <div className="p-2">
                    <div className="overflow-hidden rounded-lg border border-white/10 bg-[#0d1117]">
                      <iframe
                        src={blobUrl}
                        className="h-[70vh] w-full border-0"
                        title="PDF preview"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ===== VIDEO PREVIEW ===== */}
              {!loading && !error && previewType === "video" && blobUrl && (
                <div className="rounded-xl border border-white/10 bg-black/30">
                  <div className="border-b border-white/5 px-4 py-2">
                    <p className="eyebrow">Video Preview</p>
                  </div>
                  <div className="p-2">
                    <div className="overflow-hidden rounded-lg bg-[#0d1117]">
                      <video
                        src={blobUrl}
                        controls
                        className="w-full"
                        style={{ maxHeight: "70vh" }}
                      >
                        Your browser does not support the video tag.
                      </video>
                    </div>
                  </div>
                </div>
              )}

              {/* ===== AUDIO PREVIEW ===== */}
              {!loading && !error && previewType === "audio" && blobUrl && (
                <div className="rounded-xl border border-white/10 bg-black/30">
                  <div className="border-b border-white/5 px-4 py-2">
                    <p className="eyebrow">Audio Preview</p>
                  </div>
                  <div className="flex flex-col items-center gap-4 p-6">
                    <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-500/10 text-amber-300">
                      <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                    <audio
                      src={blobUrl}
                      controls
                      className="w-full max-w-md"
                    >
                      Your browser does not support the audio tag.
                    </audio>
                    <p className="text-[11px] text-slate-500">{outputName}</p>
                  </div>
                </div>
              )}

              {/* ===== 3D MODEL PREVIEW ===== */}
              {!loading && !error && previewType === "model" && (
                <div className="rounded-xl border border-white/10 bg-black/30">
                  <div className="border-b border-white/5 px-4 py-2">
                    <p className="eyebrow">3D Model Preview</p>
                  </div>
                  <div className="flex flex-col items-center gap-4 p-6 text-center">
                    <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-orange-400/20 bg-orange-500/10 text-orange-300">
                      <svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">{outputName}</p>
                      <p className="mt-1 text-xs text-slate-400">3D mesh — .{ext.toUpperCase()} · {formatSize(item.size)}</p>
                      {modelInfo && (
                        <p className="mt-2 text-[11px] text-slate-500">
                          {modelInfo.vertices > 0 ? `${modelInfo.vertices.toLocaleString()} vertices · ${modelInfo.triangles.toLocaleString()} triangles` : "Binary mesh — ready for slicer / CAD"}
                        </p>
                      )}
                    </div>
                    <p className="max-w-xs text-xs leading-relaxed text-slate-500">
                      3D preview is rendered externally. Open in folder to view in your slicer, Blender, or online viewer.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-2.5 py-1 text-[10px] font-semibold text-orange-200">STL</span>
                      <span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-2.5 py-1 text-[10px] font-semibold text-orange-200">OBJ</span>
                      <span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-2.5 py-1 text-[10px] font-semibold text-orange-200">PLY</span>
                      <span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-2.5 py-1 text-[10px] font-semibold text-orange-200">3MF</span>
                      <span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-2.5 py-1 text-[10px] font-semibold text-orange-200">GLB</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ===== SPREADSHEET PREVIEW ===== */}
              {!loading && !error && previewType === "spreadsheet" && sheetPreview && (
                <div className="rounded-xl border border-white/10 bg-black/30">
                  <div className="border-b border-white/5 flex items-center justify-between px-4 py-2">
                    <p className="eyebrow">Spreadsheet Preview — {sheetPreview.sheetName}</p>
                    <span className="text-[10px] text-slate-500">{sheetPreview.rows.length} rows</span>
                  </div>
                  <div className="overflow-auto p-2">
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr>
                          {sheetPreview.headers.map((h, i) => (
                            <th key={i} className="border border-white/10 bg-white/[0.04] px-2 py-1.5 text-left font-semibold text-slate-300">{h || `Col ${i+1}`}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sheetPreview.rows.map((row, ri) => (
                          <tr key={ri} className={ri % 2 === 0 ? "bg-white/[0.02]" : ""}>
                            {row.map((cell, ci) => (
                              <td key={ci} className="border border-white/5 px-2 py-1 text-slate-400">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {!loading && !error && previewType === "spreadsheet" && !sheetPreview && (
                <div className="rounded-xl border border-white/10 bg-black/30 p-6 text-center">
                  <p className="text-xs text-slate-400">Spreadsheet preview not available — open in folder.</p>
                </div>
              )}

              {/* ===== NO PREVIEW (only truly unsupported types) ===== */}
              {!loading && !error && previewType === "none" && (
                <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-400">
                    <FileTypeIcon ext={ext} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-200">{outputName}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">
                      .{ext} file
                    </p>
                  </div>
                  <p className="max-w-xs text-xs leading-relaxed text-slate-500">
                    Preview is not available for this file type. Click &quot;Open in folder&quot; to open it.
                  </p>
                  {item.size > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] text-slate-400">
                      {formatSize(item.size)}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 border-t border-white/10 px-5 py-3">
              <button
                type="button"
                onClick={handleReveal}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-300"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                Open in folder
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
