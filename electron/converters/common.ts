// ============================================================
// L2L — Shared conversion helpers & security checks
// ============================================================

import fs from "node:fs";
import path from "node:path";

import type { ProgressEvent } from "../../shared/ipc";
import type { Quality } from "../../shared/formats";

/** Progress reporter callback — forwards partial progress events upstream. */
export type Reporter = (e: Partial<ProgressEvent>) => void;

/** Removes path separators and filesystem-hostile characters from generated names. */
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
}

/**
 * Output names are checked against BOTH the filesystem and a session-level
 * reservation set, so two concurrent conversions (our pool runs 2 workers)
 * of different sources with the same basename never collide — originals and
 * converted files are NEVER overwritten.
 */
const reservedPaths = new Set<string>();

/**
 * A converter is not a general-purpose archive processor. Keep a single file
 * within a generous desktop-friendly ceiling so malformed input cannot exhaust
 * the Electron main process before its parser gets a chance to reject it.
 */
export const MAX_INPUT_BYTES = 1024 * 1024 * 1024; // 1 GiB

export function uniquePath(dir: string, base: string, ext: string): string {
  const safeBase = sanitizeFileName(base);
  let candidate = path.join(dir, `${safeBase}.${ext}`);
  let i = 1;
  while (fs.existsSync(candidate) || reservedPaths.has(candidate)) {
    candidate = path.join(dir, `${safeBase} (${i}).${ext}`);
    i += 1;
  }
  reservedPaths.add(candidate);
  return candidate;
}

/** Releases a completed output reservation. Files on disk still prevent reuse. */
export function releaseReservedPaths(paths: readonly string[]): void {
  for (const outputPath of paths) reservedPaths.delete(outputPath);
}

/** Validates that the input is a real, existing file. */
export function assertSafeInput(inputPath: unknown): string {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new Error("Invalid input path.");
  }
  const p = path.resolve(inputPath);
  if (!fs.existsSync(p)) throw new Error(`File not found: ${inputPath}`);
  const stat = fs.statSync(p);
  if (!stat.isFile()) throw new Error(`Not a file: ${inputPath}`);
  if (stat.size > MAX_INPUT_BYTES) {
    throw new Error("This file is larger than L2L's 1 GB safety limit.");
  }
  return p;
}

/**
 * Resolves the output directory. Falls back to the source file's own
 * directory (converted file is added NEXT TO the original, never replaces it).
 */
export function assertSafeOutputDir(dir: unknown, inputPath: string): string {
  if (dir == null || dir === "") return path.dirname(path.resolve(inputPath));
  if (typeof dir !== "string") throw new Error("Invalid output folder.");
  const d = path.resolve(dir);
  if (!fs.existsSync(d)) throw new Error(`Output folder not found: ${dir}`);
  if (!fs.statSync(d).isDirectory()) throw new Error(`Not a folder: ${dir}`);
  return d;
}

/**
 * Encoder parameters per quality level. The UI no longer exposes a quality
 * selector — the app always sends "lossless". Video uses a visually
 * lossless CRF (12) rather than true lossless (0): the latter balloons
 * files 10x+ for no visible gain, which would surprise users.
 */
export const QUALITY_META: Record<
  Quality,
  { imageQuality: number; videoCrf: number; audioBitrate: string; pdfScale: number }
> = {
  low: { imageQuality: 55, videoCrf: 30, audioBitrate: "96k", pdfScale: 1.5 },
  normal: { imageQuality: 80, videoCrf: 23, audioBitrate: "192k", pdfScale: 2 },
  high: { imageQuality: 95, videoCrf: 18, audioBitrate: "320k", pdfScale: 3 },
  lossless: { imageQuality: 100, videoCrf: 12, audioBitrate: "320k", pdfScale: 4 },
};

/** Human-friendly suggestion for common ffmpeg/sharp errors. */
export function friendlyError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("no such file") || s.includes("file not found")) return raw + " — Check the file still exists and the path is correct.";
  if (s.includes("invalid data") || s.includes("decode") ) return raw + " — File may be corrupted or not actually the format its extension claims. Try opening it in another app.";
  if (s.includes("unsupported") || s.includes("unknown encoder")) return raw + " — This format combination isn’t supported. Try a more common target like PNG or MP4.";
  if (s.includes("permission") ) return raw + " — Permission denied. Check the file isn’t locked and the output folder is writable.";
  if (s.includes("pixel") || s.includes("80 mp")) return raw + " — Image is too large (80MP limit). Try resizing before conversion.";
  if (s.includes("1 gb") || s.includes("safety limit")) return raw + " — File exceeds L2L’s safety limit. Split it or choose a smaller file.";
  if (s.includes("cancelled")) return "Cancelled by user.";
  if (s.includes("timeout") || s.includes("two-hour")) return raw + " — Conversion took too long and was stopped for safety.";
  return raw;
}
