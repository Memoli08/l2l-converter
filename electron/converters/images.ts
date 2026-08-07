// ============================================================
// L2L — Image converter (sharp)
// PNG / JPG / WebP / GIF / AVIF / TIFF output, BMP/SVG input,
// plus image → PDF via pdf-lib.
// ============================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import ffmpegPath from "ffmpeg-static";

import type { Quality } from "../../shared/formats";
import { QUALITY_META, Reporter, uniquePath } from "./common";
import { removeBackground } from "./background";
import { convertToAscii } from "./ascii";

const SHARP_LIMITS = { failOn: "none" as const, limitInputPixels: 80_000_000 };

export interface ImageJob {
  inputPath: string;
  target: string;
  quality: Quality;
  outputDir: string;
  report: Reporter;
}

/**
 * The prebuilt sharp/libvips in this project has no BMP decoder, yet BMP is a
 * declared input format. ffmpeg (always bundled for video/audio) reads BMP
 * fine, so we normalize BMP → temporary PNG first and return that path.
 * Returns the original path untouched for every other format.
 */
async function ensureSharpReadable(inputPath: string): Promise<string> {
  const ext = path.extname(inputPath).slice(1).toLowerCase();
  if (ext !== "bmp") return inputPath;

  const tmp = path.join(os.tmpdir(), `l2l-bmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await new Promise<void>((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg binary unavailable — cannot read BMP files."));
      return;
    }
    const proc = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, tmp]);
    let err = "";
    proc.stderr.on("data", (d: Buffer) => {
      if (err.length < 64 * 1024) err += d.toString();
    });
    proc.on("error", (e) => reject(new Error(`ffmpeg failed to start: ${e.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim().slice(-200) || `Failed to read BMP file (ffmpeg exited ${code}).`));
    });
  });
  return tmp;
}

async function runConvert(inputPath: string, opts: ImageJob, base: string, q: number): Promise<string[]> {
  const { target, outputDir, report } = opts;

  report({ percent: 5, stage: "Reading image…" });

  // ---- remove background (flood-fill, fully local) → transparent PNG ----
  if (target === "removebg") {
    const outputPath = uniquePath(outputDir, `${base}-nobg`, "png");
    report({ percent: 25, stage: "Detecting background…" });
    await removeBackground(inputPath, outputPath);
    report({ percent: 100, stage: "Done" });
    return [outputPath];
  }

  // ---- ASCII art (photo → monospace text) ----
  if (target === "ascii") {
    const outputPath = uniquePath(outputDir, `${base}-ascii`, "txt");
    report({ percent: 15, stage: "Rendering ASCII art…" });
    await convertToAscii(inputPath, outputPath, report);
    report({ percent: 100, stage: "Done" });
    return [outputPath];
  }

  // ---- image → PDF (via pdf-lib, embedding a normalized PNG) ----
  if (target === "pdf") {
    const outputPath = uniquePath(outputDir, base, "pdf");
    const pngBuffer = await sharp(inputPath, SHARP_LIMITS).rotate().png().toBuffer();
    const meta = await sharp(pngBuffer).metadata();
    const width = meta.width ?? 600;
    const height = meta.height ?? 400;

    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(pngBuffer);
    const page = pdf.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
    fs.writeFileSync(outputPath, await pdf.save());

    report({ percent: 100, stage: "Done" });
    return [outputPath];
  }

  // ---- image → image ----
  const ext = target === "jpeg" ? "jpg" : target;
  const outputPath = uniquePath(outputDir, base, ext);

  let pipeline = sharp(inputPath, SHARP_LIMITS).rotate();
  switch (target) {
    case "jpg":
      pipeline = pipeline.jpeg({ quality: q, mozjpeg: true });
      break;
    case "png":
      pipeline = pipeline.png();
      break;
    case "webp":
      pipeline = pipeline.webp({ quality: q });
      break;
    case "gif":
      pipeline = pipeline.gif();
      break;
    case "avif":
      pipeline = pipeline.avif({ quality: q });
      break;
    case "tiff":
      pipeline = pipeline.tiff();
      break;
    default:
      throw new Error(`Unsupported image target: ${target}`);
  }

  report({ percent: 40, stage: "Encoding…" });
  await pipeline.toFile(outputPath);
  report({ percent: 100, stage: "Done" });
  return [outputPath];
}

export async function convertImage(opts: ImageJob): Promise<string[]> {
  const { inputPath } = opts;
  const base = path.basename(inputPath, path.extname(inputPath));
  const q = QUALITY_META[opts.quality].imageQuality;

  const workPath = await ensureSharpReadable(inputPath);
  try {
    return await runConvert(workPath, opts, base, q);
  } finally {
    if (workPath !== inputPath) {
      try {
        fs.unlinkSync(workPath);
      } catch {
        /* best-effort temp cleanup */
      }
    }
  }
}
