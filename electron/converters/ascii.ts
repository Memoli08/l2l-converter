// ============================================================
// L2L — ASCII Art converter
// Turns any photo into monospace text-art (.txt), fully local.
// 2× supersampling + per-character block averaging + automatic
// contrast stretch → the best possible art with zero settings.
//
// When a color hex is supplied, an HTML file is also produced
// so the user sees the art in the chosen color.
// ============================================================

import fs from "node:fs";

import sharp from "sharp";

import { HEX_COLOR_RE } from "../../shared/ipc";
import type { Reporter } from "./common";

/** Maximum width in characters; tall images stay proportional. */
const MAX_WIDTH = 120;
/** Maximum height in characters (guards extreme panoramas). */
const MAX_HEIGHT = 400;
/** Brightness → character ramp (dark → dense glyph, bright → space). */
const RAMP = "@%#*+=-:. ";
const SHARP_LIMITS = { failOn: "none" as const, limitInputPixels: 80_000_000 };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Reads the image and writes a `.txt` file where each character
 * represents the average brightness of a block of source pixels.
 * If `color` is provided, also writes an `.html` file that renders
 * the art in the chosen foreground colour on a dark background.
 */
export async function convertToAscii(
  inputPath: string,
  outputPath: string,
  report?: Reporter,
  color?: string,
): Promise<void> {
  report?.({ percent: 10, stage: "Reading image…" });

  const meta = await sharp(inputPath, SHARP_LIMITS).rotate().metadata();
  const ow = meta.width ?? 0;
  const oh = meta.height ?? 0;
  if (!ow || !oh) throw new Error("Could not read image dimensions.");

  // Terminal characters are roughly twice as tall as they are wide, so the
  // art keeps the photo's proportions only if we halve the height. Clamp the
  // height for extreme aspect ratios by shrinking the width instead.
  let width = Math.max(1, Math.min(MAX_WIDTH, Math.round(ow / 2)));
  let height = Math.max(1, Math.round(width * (oh / ow) * 0.5));
  if (height > MAX_HEIGHT) {
    width = Math.max(1, Math.round((width * MAX_HEIGHT) / height));
    height = MAX_HEIGHT;
  }

  report?.({ percent: 25, stage: "Sampling pixels…" });

  // Supersample 2× and block-average 2×2 → each character reflects 4 source
  // pixels, which reads far smoother than nearest-neighbour sampling.
  const sw = width * 2;
  const sh = height * 2;
  const { data, info } = await sharp(inputPath, SHARP_LIMITS)
    .rotate()
    .resize(sw, sh, { fit: "fill", kernel: "lanczos3" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // sharp's raw output may expand to 3 channels; always honor the stride.
  const stride = info.channels || 1;

  const g = new Float32Array(width * height);
  let min = 255;
  let max = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          s += data[((y * 2 + dy) * sw + x * 2 + dx) * stride];
        }
      }
      const v = s / 4;
      g[y * width + x] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  report?.({ percent: 70, stage: "Rendering characters…" });

  // Contrast stretch maps the photo's own darkest/brightest pixels onto the
  // full ramp — automatic "max quality", no settings to fiddle with.
  const range = max - min;
  const lines: string[] = [];
  for (let y = 0; y < height; y++) {
    let line = "";
    for (let x = 0; x < width; x++) {
      const t = range > 1 ? (g[y * width + x] - min) / range : 0.5;
      const idx = Math.min(RAMP.length - 1, Math.floor(t * RAMP.length));
      line += RAMP[idx];
    }
    lines.push(line.replace(/\s+$/, ""));
  }

  // Always write the plain-text version.
  fs.writeFileSync(outputPath, lines.join("\n") + "\n");

  // If a colour was requested, also write an HTML file that renders
  // the ASCII art in the chosen foreground colour on a dark background.
  if (color && HEX_COLOR_RE.test(color)) {
    const htmlPath = outputPath.replace(/\.txt$/i, ".html");
    const htmlLines = lines.map((l) => `<span>${escapeHtml(l)}</span>`).join("\n");
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>ASCII Art</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0d1117;
    color: ${color};
    font-family: 'DejaVu Sans Mono', 'Courier New', monospace;
    font-size: 14px;
    line-height: 1.15;
    white-space: pre;
    padding: 24px;
    overflow: auto;
  }
</style>
</head>
<body>
${htmlLines}
</body>
</html>`;
    fs.writeFileSync(htmlPath, html, "utf8");
  }

  report?.({ percent: 100, stage: "Done" });
}
