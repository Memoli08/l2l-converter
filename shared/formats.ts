// ============================================================
// L2L — Format matrix
// Extension → file kind → valid conversion targets
// Used by both the Electron main process and the Next.js frontend.
// ============================================================

export type FileKind = "image" | "video" | "audio" | "document" | "model";

export type Quality = "low" | "normal" | "high" | "lossless";

export interface Target {
  id: string; // e.g. 'png', 'mp4', 'pdf'
  label: string; // display name
  kind: FileKind; // kind of the output
  hint?: string; // extra note (e.g. 'Extract audio')
}

// ---- Supported extensions ----
export const IMAGE_EXTS = [
  "png", "jpg", "jpeg", "webp", "gif", "avif", "tif", "tiff", "bmp", "svg",
];
export const VIDEO_EXTS = [
  "mp4", "mkv", "webm", "mov", "avi", "mpg", "mpeg", "wmv", "flv", "3gp", "m4v", "ogv",
  // NOTE: ".ts" (MPEG-TS) is intentionally NOT advertised: the bundled
  // ffmpeg-static build segfaults (SIGSEGV) in its MPEG-TS demuxer, so .ts
  // files cannot be converted safely. Re-add once ffmpeg-static is updated.
];
export const AUDIO_EXTS = [
  "mp3", "wav", "flac", "ogg", "oga", "m4a", "aac", "wma", "opus", "aiff", "aif", "ac3", "amr",
];
export const DOC_EXTS = ["pdf", "txt", "md", "markdown", "html", "htm", "docx", "csv", "xlsx"];

export const MODEL_EXTS = ["stl", "obj", "ply", "3mf", "glb"];

export const ALL_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS, ...DOC_EXTS, ...MODEL_EXTS];

// ---- Helpers ----
export function extOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

export function baseNameOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot === -1 ? base : base.slice(0, dot);
}

export function kindOf(ext: string): FileKind | null {
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.includes(e)) return "image";
  if (VIDEO_EXTS.includes(e)) return "video";
  if (AUDIO_EXTS.includes(e)) return "audio";
  if (DOC_EXTS.includes(e)) return "document";
  if (MODEL_EXTS.includes(e)) return "model";
  return null;
}

export function isSupported(ext: string): boolean {
  return ALL_EXTS.includes(ext.toLowerCase());
}

// ---- Target matrix ----
const IMAGE_TARGETS: Target[] = [
  { id: "png", label: "PNG", kind: "image" },
  { id: "jpg", label: "JPG", kind: "image" },
  { id: "webp", label: "WebP", kind: "image" },
  { id: "gif", label: "GIF", kind: "image" },
  { id: "avif", label: "AVIF", kind: "image" },
  { id: "tiff", label: "TIFF", kind: "image" },
  { id: "removebg", label: "Remove BG", kind: "image", hint: "Best for plain backgrounds" },
  { id: "ascii", label: "ASCII Art", kind: "document", hint: "Photo → text art (.txt)" },
  { id: "pdf", label: "PDF", kind: "document" },
];

const VIDEO_TARGETS: Target[] = [
  { id: "mp4", label: "MP4", kind: "video" },
  { id: "webm", label: "WebM", kind: "video" },
  { id: "mkv", label: "MKV", kind: "video" },
  { id: "mov", label: "MOV", kind: "video" },
  { id: "avi", label: "AVI", kind: "video" },
  { id: "mpeg", label: "MPEG", kind: "video" },
  { id: "ogv", label: "OGV", kind: "video" },
  { id: "gif", label: "GIF", kind: "video", hint: "Animated" },
  { id: "mp3", label: "MP3", kind: "audio", hint: "Extract audio" },
];

const AUDIO_TARGETS: Target[] = [
  { id: "mp3", label: "MP3", kind: "audio" },
  { id: "wav", label: "WAV", kind: "audio" },
  { id: "flac", label: "FLAC", kind: "audio" },
  { id: "ogg", label: "OGG", kind: "audio" },
  { id: "m4a", label: "M4A", kind: "audio" },
  { id: "aac", label: "AAC", kind: "audio" },
  { id: "opus", label: "OPUS", kind: "audio" },
  { id: "aiff", label: "AIFF", kind: "audio" },
  { id: "ac3", label: "AC3", kind: "audio" },
];

const PDF_TARGETS: Target[] = [
  { id: "png", label: "PNG", kind: "image", hint: "Page image" },
  { id: "jpg", label: "JPG", kind: "image", hint: "Page image" },
  { id: "webp", label: "WebP", kind: "image", hint: "Page image" },
  { id: "txt", label: "TXT", kind: "document", hint: "Extract text" },
  { id: "html", label: "HTML", kind: "document", hint: "Extract text" },
];

const MODEL_TARGETS: Target[] = [
  { id: "stl", label: "STL", kind: "model" },
  { id: "obj", label: "OBJ", kind: "model" },
  { id: "ply", label: "PLY", kind: "model" },
  { id: "3mf", label: "3MF", kind: "model" },
  { id: "glb", label: "GLB", kind: "model" },
];

export function targetsFor(ext: string): Target[] {
  const kind = kindOf(ext);
  if (!kind) return [];
  switch (kind) {
    case "image":
      return IMAGE_TARGETS;
    case "video":
      return VIDEO_TARGETS;
    case "audio":
      return AUDIO_TARGETS;
    case "model":
      return MODEL_TARGETS;
    case "document": {
      switch (ext.toLowerCase()) {
        case "pdf":
          return PDF_TARGETS;
        case "txt":
          return [
            { id: "md", label: "Markdown", kind: "document" },
            { id: "html", label: "HTML", kind: "document" },
            { id: "pdf", label: "PDF", kind: "document" },
          ];
        case "md":
        case "markdown":
          return [
            { id: "txt", label: "TXT", kind: "document" },
            { id: "html", label: "HTML", kind: "document" },
            { id: "pdf", label: "PDF", kind: "document" },
          ];
        case "html":
        case "htm":
          return [
            { id: "txt", label: "TXT", kind: "document" },
            { id: "md", label: "Markdown", kind: "document" },
            { id: "pdf", label: "PDF", kind: "document" },
          ];
        case "docx":
          return [
            { id: "md", label: "Markdown", kind: "document" },
            { id: "html", label: "HTML", kind: "document" },
            { id: "txt", label: "TXT", kind: "document" },
            { id: "pdf", label: "PDF", kind: "document" },
          ];
        case "csv":
          return [{ id: "xlsx", label: "XLSX", kind: "document" }];
        case "xlsx":
          return [{ id: "csv", label: "CSV", kind: "document" }];
        default:
          return [];
      }
    }
  }
}

export function defaultTargetFor(ext: string): string | null {
  const targets = targetsFor(ext);
  return targets.length ? targets[0].id : null;
}
