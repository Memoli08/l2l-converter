// ============================================================
// L2L — Video & audio converter
// Spawns the bundled ffmpeg binary directly (no shell, no
// deprecated wrapper). Progress is parsed from `-progress pipe:1`.
// ============================================================

import path from "node:path";
import { spawn } from "node:child_process";

import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

import type { Quality } from "../../shared/formats";
import { friendlyError, QUALITY_META, Reporter, uniquePath } from "./common";

if (!ffmpegPath) throw new Error("ffmpeg-static binary could not be resolved.");
if (!ffprobeStatic?.path) throw new Error("ffprobe-static binary could not be resolved.");

const FFMPEG = ffmpegPath;
const FFPROBE = ffprobeStatic.path;
const PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MAX_STDERR_BYTES = 512 * 1024;

// Active ffmpeg procs by job id — for cancellation
const activeProcs = new Map<string, ReturnType<typeof spawn>>();

export function cancelActiveJob(id: string): boolean {
  const proc = activeProcs.get(id);
  if (proc) {
    try { proc.kill("SIGKILL"); } catch { /* ignore */ }
    activeProcs.delete(id);
    return true;
  }
  return false;
}

export function getActiveJobCount(): number {
  return activeProcs.size;
}

const probeCache = new Map<string, { duration: number; mtime: number }>();

function probeDuration(inputPath: string): Promise<number> {
  try {
    const stat = require("node:fs").statSync(inputPath);
    const cached = probeCache.get(inputPath);
    if (cached && cached.mtime === stat.mtimeMs) return Promise.resolve(cached.duration);
  } catch { /* ignore */ }
  return new Promise((resolve) => {
    const proc = spawn(FFPROBE, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ]);
    let out = "";
    proc.stdout.on("data", (d: Buffer) => {
      if (out.length < 16 * 1024) out += d.toString();
    });
    proc.on("error", () => resolve(0));
    proc.on("close", () => {
      const n = parseFloat(out.trim());
      const dur = Number.isFinite(n) ? n : 0;
      try {
        const stat2 = require("node:fs").statSync(inputPath);
        probeCache.set(inputPath, { duration: dur, mtime: stat2.mtimeMs });
        if (probeCache.size > 200) {
          const first = probeCache.keys().next().value;
          if (first) probeCache.delete(first);
        }
      } catch { /* ignore */ }
      resolve(dur);
    });
  });
}

function extractError(stderr: string): string {
  const lines = stderr.split("\n").filter(Boolean);
  const errLines = lines.filter((l) => /error|invalid|failed|not found|no such|unable/i.test(l));
  if (errLines.length) return errLines.slice(-2).join(" | ");
  return lines.slice(-4).join(" ").trim();
}

function runFfmpeg(args: string[], report: Reporter, durationSec: number, jobId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, [
      "-hide_banner", "-nostdin", "-y",
      "-progress", "pipe:1",
      ...args,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    if (jobId) activeProcs.set(jobId, proc);

    let stderr = "";
    let lastPct = 0;
    let timedOut = false;
    let stdoutBuf = "";
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, PROCESS_TIMEOUT_MS);

    proc.stdout.on("data", (d: Buffer) => {
      // ffmpeg -progress is line-delimited; Buffer may split lines arbitrarily
      // so we accumulate and parse per-line.
      stdoutBuf += d.toString();
      let idx: number;
      while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        const m = /out_time_us=(\d+)/.exec(line);
        if (m && durationSec > 0) {
          const secs = parseInt(m[1], 10) / 1_000_000;
          const pct = Math.min(99, Math.round((secs / durationSec) * 100));
          if (pct > lastPct) {
            lastPct = pct;
            report({ percent: pct, stage: "Processing…" });
          }
        }
        // Also handle progress=end → 100% even if duration unknown
        if (line.includes("progress=end") && durationSec === 0) {
          report({ percent: 99, stage: "Finalizing…" });
        }
      }
      // Prevent unbounded growth on malformed output
      if (stdoutBuf.length > 4096) stdoutBuf = stdoutBuf.slice(-4096);
    });

    proc.stderr.on("data", (d: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += d.toString();
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      if (jobId) activeProcs.delete(jobId);
      reject(new Error(err.message || String(err)));
    });
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (jobId) activeProcs.delete(jobId);
      if (signal === "SIGKILL" && !timedOut) {
        reject(new Error("Cancelled by user."));
        return;
      }
      if (code === 0) {
        report({ percent: 100, stage: "Done" });
        resolve();
      } else if (timedOut) {
        reject(new Error(friendlyError("Conversion exceeded L2L's two-hour safety limit.")));
      } else {
        const hint = stderr.length >= MAX_STDERR_BYTES ? " (output truncated)" : "";
        reject(new Error(friendlyError((extractError(stderr) || `ffmpeg exited with code ${code}`) + hint)));
      }
    });
  });
}

/** Maps x264-style CRF to a VP9-friendly CRF (0–63 scale). */
function vp9Crf(crf: number): number {
  if (crf === 0) return 8; // near-lossless
  return Math.round((crf / 30) * 60) + 3;
}

function videoEncoderArgs(target: string, crf: number): string[] {
  switch (target) {
    case "mp4":
      return ["-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k"];
    case "webm":
      return ["-c:v", "libvpx-vp9", "-crf", String(vp9Crf(crf)), "-b:v", "0", "-row-mt", "1", "-c:a", "libopus"];
    case "mkv":
      return ["-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-c:a", "aac"];
    case "mov":
      return ["-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "aac"];
    case "avi":
      return ["-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "aac"];
    case "mpeg":
      return ["-c:v", "mpeg2video", "-q:v", String(Math.min(10, 2 + Math.round(crf / 3))), "-c:a", "mp2"];
    case "ogv":
      return ["-c:v", "libtheora", "-q:v", "6", "-c:a", "libvorbis"];
    default:
      throw new Error(`Unsupported video target: ${target}`);
  }
}

function audioEncoderArgs(target: string, quality: Quality, bitrate: string): string[] {
  switch (target) {
    case "mp3":
      return ["-c:a", "libmp3lame", "-b:a", bitrate];
    case "wav":
      return ["-c:a", "pcm_s16le"];
    case "flac":
      return ["-c:a", "flac"];
    case "ogg":
      return ["-c:a", "libvorbis", "-q:a", quality === "low" ? "3" : quality === "high" ? "8" : "6"];
    case "m4a":
      return ["-c:a", "aac", "-b:a", bitrate];
    case "aac":
      return ["-c:a", "aac", "-b:a", bitrate];
    case "opus":
      return ["-c:a", "libopus", "-b:a", bitrate];
    case "aiff":
      return ["-c:a", "pcm_s16be"];
    case "ac3":
      return ["-c:a", "ac3", "-b:a", "448k"];
    default:
      throw new Error(`Unsupported audio target: ${target}`);
  }
}

export interface MediaJob {
  id?: string;
  inputPath: string;
  target: string;
  quality: Quality;
  outputDir: string;
  report: Reporter;
}

// ------------------------------------------------------------
// Video
// ------------------------------------------------------------
export async function convertVideo(opts: MediaJob): Promise<string[]> {
  const { inputPath, target, quality, outputDir, report } = opts;
  const base = path.basename(inputPath, path.extname(inputPath));
  const duration = await probeDuration(inputPath);

  // video → animated GIF (single-pass palette)
  if (target === "gif") {
    const outputPath = uniquePath(outputDir, base, "gif");
    await runFfmpeg(
      [
        "-i", inputPath,
        "-vf", "fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256[p];[b][p]paletteuse",
        "-loop", "0",
        outputPath,
      ],
      report,
      duration, opts.id,
    );
    return [outputPath];
  }

  // video → audio extraction
  if (target === "mp3") {
    const outputPath = uniquePath(outputDir, base, "mp3");
    await runFfmpeg(
      ["-i", inputPath, "-vn", ...audioEncoderArgs("mp3", quality, QUALITY_META[quality].audioBitrate), outputPath],
      report,
      duration, opts.id,
    );
    return [outputPath];
  }

  // video → video
  const outputPath = uniquePath(outputDir, base, target);
  await runFfmpeg(
    ["-i", inputPath, ...videoEncoderArgs(target, QUALITY_META[quality].videoCrf), outputPath],
    report,
    duration, opts.id,
  );
  return [outputPath];
}

// ------------------------------------------------------------
// Audio
// ------------------------------------------------------------
export async function convertAudio(opts: MediaJob): Promise<string[]> {
  const { inputPath, target, quality, outputDir, report } = opts;
  const base = path.basename(inputPath, path.extname(inputPath));
  const duration = await probeDuration(inputPath);
  const outputPath = uniquePath(outputDir, base, target);

  await runFfmpeg(
    ["-i", inputPath, "-vn", ...audioEncoderArgs(target, quality, QUALITY_META[quality].audioBitrate), outputPath],
    report,
    duration, opts.id,
  );
  return [outputPath];
}
