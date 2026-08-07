// ============================================================
// L2L — App icon generator
// Renders the official icon (rounded dark tile + the L2L
// transformation mark) into assets/icon.png and public/icon.png so
// the launcher icon and the in-app logo are pixel-identical.
//   node scripts/gen-icon.js
// ============================================================

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#18252d"/>
      <stop offset="100%" stop-color="#070b10"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#b1fff0"/>
      <stop offset="100%" stop-color="#69dfcb"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="118" fill="url(#surface)"/>
  <circle cx="410" cy="58" r="150" fill="#69dfcb" opacity="0.08"/>
  <g fill="none" stroke="url(#accent)" stroke-width="27" stroke-linecap="round" stroke-linejoin="round">
    <rect x="123" y="154" width="112" height="112" rx="26"/>
    <rect x="277" y="246" width="112" height="112" rx="26"/>
    <path d="M219 200h72"/>
    <path d="m273 177 24 23-24 23"/>
    <path d="M293 312h-72"/>
    <path d="m239 289-24 23 24 23"/>
  </g>
</svg>`;

async function main() {
  const png = await sharp(Buffer.from(SVG)).png({ compressionLevel: 9 }).toBuffer();

  const root = path.join(__dirname, "..");
  const assets = path.join(root, "assets");
  const pub = path.join(root, "public");
  fs.mkdirSync(assets, { recursive: true });
  fs.mkdirSync(pub, { recursive: true });

  fs.writeFileSync(path.join(assets, "icon.png"), png);
  fs.writeFileSync(path.join(pub, "icon.png"), png);
  console.log("icon written: assets/icon.png + public/icon.png (" + png.length + " bytes)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
