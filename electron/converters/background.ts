// ============================================================
// L2L — Remove Background
// Flood-fill based background removal: seeds every border pixel,
// then grows regions while the color stays close to the region's
// running mean. Pure JS + sharp — 100% local, no model downloads.
// Best results on photos with plain or smoothly graded backgrounds.
// ============================================================

import sharp from "sharp";

/** Working-resolution cap — the flood fill runs at this size. */
const WORK_CAP = 1024;
/** Output cap — avoids holding a giant full-res RGBA buffer in memory. */
const OUT_CAP = 4000;
const SHARP_LIMITS = { failOn: "none" as const, limitInputPixels: 80_000_000 };

/**
 * Reads the image, builds a background mask, upsamples it to full
 * resolution (with a light feather) and writes a PNG with a
 * transparent background.
 */
export async function removeBackground(inputPath: string, outputPath: string): Promise<void> {
  const meta = await sharp(inputPath, SHARP_LIMITS).rotate().metadata();
  const ow = meta.width ?? 0;
  const oh = meta.height ?? 0;
  if (!ow || !oh) throw new Error("Could not read image dimensions.");

  const outScale = Math.min(1, OUT_CAP / Math.max(ow, oh));
  const outW = Math.max(1, Math.round(ow * outScale));
  const outH = Math.max(1, Math.round(oh * outScale));

  // ---- working-resolution RGBA + mask (flood fill stays fast) ----
  const workScale = Math.min(1, WORK_CAP / Math.max(outW, outH));
  const w = Math.max(1, Math.round(outW * workScale));
  const h = Math.max(1, Math.round(outH * workScale));

  const { data, info } = await sharp(inputPath, SHARP_LIMITS)
    .rotate()
    .resize(w, h, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error("Unsupported pixel layout.");

  const mask = floodFillBackgroundMask(data, w, h);

  // ---- upsample the mask to the output size ----
  // Cubic upsampling already softens the hard 0/255 edge; a light blur
  // feathers it further so edges don't look jagged even at 1:1 scale.
  // NOTE: sharp's raw output defaults to 3 channels (RGB) unless the input
  // is 4-channel, so we resolve the actual channel count below.
  const upRaw = await sharp(Buffer.from(mask), { raw: { width: w, height: h, channels: 1 } })
    .resize(outW, outH, { kernel: "cubic" })
    .blur(0.6)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const up = upRaw.data;
  const upChannels = upRaw.info.channels || 1;

  // ---- apply the mask as alpha on the output-resolution image ----
  // Use the *decoded* full dims (not metadata) so the upscaled mask and the
  // RGBA data can never drift apart on EXIF/palette edge cases.
  const full = await sharp(inputPath, SHARP_LIMITS)
    .rotate()
    .resize(outW, outH, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const fdata = full.data;
  const n = full.info.width * full.info.height;
  for (let i = 0; i < n; i++) {
    fdata[i * 4 + 3] = Math.round((up[i * upChannels] / 255) * fdata[i * 4 + 3]);
  }

  await sharp(fdata, {
    raw: { width: full.info.width, height: full.info.height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}

/**
 * Returns a Uint8Array mask (w*h): 0 = background (transparent),
 * 255 = foreground (kept). Border pixels seed the flood fill; a
 * pixel joins the background if its color is within tolerance of the
 * region's running mean color (handles gentle gradients too).
 */
export function floodFillBackgroundMask(data: Buffer, w: number, h: number): Uint8Array {
  const visited = new Uint8Array(w * h); // 1 = background, 0 = not yet / foreground

  const px = (x: number, y: number): [number, number, number] => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  interface QueueItem {
    x: number;
    y: number;
    mr: number; // running mean color of the region
    mg: number;
    mb: number;
    count: number;
  }

  const queue: QueueItem[] = [];

  // ---- auto tolerance from border color variance ----
  const borderColors: Array<[number, number, number]> = [];
  for (let x = 0; x < w; x++) {
    borderColors.push(px(x, 0), px(x, h - 1));
  }
  for (let y = 1; y < h - 1; y++) {
    borderColors.push(px(0, y), px(w - 1, y));
  }
  let mr = 0;
  let mg = 0;
  let mb = 0;
  for (const [r, g, b] of borderColors) {
    mr += r;
    mg += g;
    mb += b;
  }
  const cnt = borderColors.length || 1;
  mr /= cnt;
  mg /= cnt;
  mb /= cnt;
  let variance = 0;
  for (const [r, g, b] of borderColors) {
    variance += (r - mr) ** 2 + (g - mg) ** 2 + (b - mb) ** 2;
  }
  const std = Math.sqrt(variance / cnt);
  // solid background → tight tolerance; gradient/shadows → wider, clamped.
  const tolerance = Math.max(24, Math.min(90, std * 1.8 + 26));
  const tol2 = tolerance * tolerance;

  // ---- seed every border pixel ----
  const seed = (x: number, y: number) => {
    const i = y * w + x;
    if (x < 0 || y < 0 || x >= w || y >= h || visited[i]) return;
    visited[i] = 1;
    const [r, g, b] = px(x, y);
    queue.push({ x, y, mr: r, mg: g, mb: b, count: 1 });
  };
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }

  // ---- grow ----
  let head = 0;
  while (head < queue.length) {
    const q = queue[head++];
    const neighbors: Array<[number, number]> = [
      [q.x + 1, q.y],
      [q.x - 1, q.y],
      [q.x, q.y + 1],
      [q.x, q.y - 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const i = ny * w + nx;
      if (visited[i]) continue;
      const [r, g, b] = px(nx, ny);
      const dr = r - q.mr;
      const dg = g - q.mg;
      const db = b - q.mb;
      if (dr * dr + dg * dg + db * db <= tol2) {
        visited[i] = 1;
        const nCount = q.count + 1;
        queue.push({
          x: nx,
          y: ny,
          mr: (q.mr * q.count + r) / nCount,
          mg: (q.mg * q.count + g) / nCount,
          mb: (q.mb * q.count + b) / nCount,
          count: nCount,
        });
      }
    }
  }

  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    mask[i] = visited[i] === 1 ? 0 : 255;
  }
  return mask;
}
