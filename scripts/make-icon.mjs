// Generates assets/icon.png (512×512) from an inline SVG — no asset editor needed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <defs>
    <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#18252d"/>
      <stop offset="100%" stop-color="#070b10"/>
    </linearGradient>
    <linearGradient id="fg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#b1fff0"/>
      <stop offset="100%" stop-color="#69dfcb"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="512" height="512" rx="112" fill="url(#surface)"/>
  <g fill="none" stroke="url(#fg)" stroke-width="27" stroke-linecap="round" stroke-linejoin="round">
    <rect x="123" y="154" width="112" height="112" rx="26"/>
    <rect x="277" y="246" width="112" height="112" rx="26"/>
    <path d="M219 200h72"/>
    <path d="m273 177 24 23-24 23"/>
    <path d="M293 312h-72"/>
    <path d="m239 289-24 23 24 23"/>
  </g>
</svg>`;

const out = path.join(__dirname, "../assets/icon.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(out);
console.log(`Icon written to ${out}`);
