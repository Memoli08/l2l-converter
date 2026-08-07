// ============================================================
// L2L — Full format-matrix test
// Generates a real sample file for EVERY supported extension,
// then converts it to EVERY declared target for that extension.
// Answer: "can every convertible file actually be converted?"
//   node scripts/launch.js test/matrix-test.js   (must run in
//   Electron because HTML→PDF uses a hidden BrowserWindow)
// ============================================================

const { app } = require("electron");

app.disableHardwareAcceleration();

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");
const { Document, Packer, Paragraph, TextRun } = require("docx");
const ExcelJS = require("exceljs");
const ffmpegPath = require("ffmpeg-static");

const { convertJob } = require("../dist-electron/electron/converters/index.js");
const { ALL_EXTS, targetsFor, extOf } = require("../dist-electron/shared/formats.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "l2l-matrix-"));
const report = () => {};

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  passed += 1;
  console.log(`  \u2713 ${name}`);
}

function bad(name, err) {
  failed += 1;
  const msg = err && err.message ? err.message : String(err);
  failures.push(`${name}: ${msg}`);
  console.log(`  \u2717 ${name} \u2014 ${msg}`);
}

function ffmpegRun(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ["-hide_banner", "-nostdin", "-y", ...args]);
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-300)))));
  });
}

function makeBmp(filePath, w = 96, h = 72) {
  // 24-bit uncompressed BMP (BGR, bottom-up rows) — sharp has no .bmp() output here.
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const pixelBytes = rowSize * h;
  const buf = Buffer.alloc(54 + pixelBytes);
  buf.write("BM", 0);
  buf.writeUInt32LE(54 + pixelBytes, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixelBytes, 34);
  for (let y = 0; y < h; y++) {
    const row = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const off = 54 + row * rowSize + x * 3;
      buf[off] = Math.round((y / h) * 255); // B
      buf[off + 1] = 120; // G
      buf[off + 2] = Math.round((x / w) * 255); // R
    }
  }
  fs.writeFileSync(filePath, buf);
}

function makeWav(filePath, seconds = 0.6, freq = 440) {
  const sampleRate = 44100;
  const n = Math.floor(seconds * sampleRate);
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 12000);
    buf.writeInt16LE(v, 44 + i * 2);
  }
  fs.writeFileSync(filePath, buf);
}

async function convertOne(inputPath, target, outDir) {
  const outputs = await convertJob(
    { id: Math.random().toString(36).slice(2), inputPath, target, quality: "normal", outputDir: outDir },
    report,
  );
  if (!Array.isArray(outputs) || outputs.length === 0) throw new Error("no outputs returned");
  for (const p of outputs) {
    if (!fs.existsSync(p)) throw new Error(`output missing: ${p}`);
    if (fs.statSync(p).size === 0) throw new Error(`output is empty: ${p}`);
  }
  return outputs;
}

// ------------------------------------------------------------
// 1. Generate one real sample file per supported extension
// ------------------------------------------------------------
async function generateSamples() {
  const dir = path.join(tmp, "samples");
  fs.mkdirSync(dir, { recursive: true });
  const s = {};

  // ---- images: build from one SVG through sharp ----
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="72">` +
      `<rect width="96" height="72" fill="#f5a623"/>` +
      `<circle cx="48" cy="36" r="24" fill="#1e90ff"/>` +
      `<rect x="10" y="10" width="20" height="20" fill="#2ecc71"/></svg>`,
  );
  const base = path.join(dir, "img-base.png");
  await sharp(svg).png().toFile(base);
  const imgVariants = {
    png: base,
    jpg: path.join(dir, "img.jpg"),
    jpeg: path.join(dir, "img-jpeg.jpg"),
    webp: path.join(dir, "img.webp"),
    gif: path.join(dir, "img.gif"),
    avif: path.join(dir, "img.avif"),
    tif: path.join(dir, "img.tif"),
    tiff: path.join(dir, "img.tiff"),
    bmp: path.join(dir, "img.bmp"),
    svg: path.join(dir, "img.svg"),
  };
  await sharp(base).jpeg().toFile(imgVariants.jpg);
  fs.copyFileSync(imgVariants.jpg, imgVariants.jpeg);
  await sharp(base).webp().toFile(imgVariants.webp);
  await sharp(base).gif().toFile(imgVariants.gif);
  await sharp(base).avif().toFile(imgVariants.avif);
  await sharp(base).tiff().toFile(imgVariants.tif);
  fs.copyFileSync(imgVariants.tif, imgVariants.tiff);
  makeBmp(imgVariants.bmp);
  fs.writeFileSync(imgVariants.svg, svg);
  Object.assign(s, imgVariants);

  // ---- video: make an mp4, then remux to every other container ----
  const mp4 = path.join(dir, "vid.mp4");
  await ffmpegRun([
    "-f", "lavfi", "-i", "testsrc=duration=1:size=128x96:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mp4,
  ]);
  s.mp4 = mp4;
  const vidEnc = {
    mkv: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"],
    webm: ["-c:v", "libvpx-vp9", "-c:a", "libopus"],
    mov: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"],
    avi: ["-c:v", "mpeg4", "-q:v", "4", "-c:a", "mp3"],
    mpg: ["-c:v", "mpeg2video", "-q:v", "4", "-c:a", "mp2"],
    mpeg: ["-c:v", "mpeg2video", "-q:v", "4", "-c:a", "mp2"],
    wmv: ["-c:v", "wmv2", "-b:v", "300k", "-c:a", "wmav2"],
    flv: ["-c:v", "flv", "-q:v", "5", "-c:a", "mp3"],
    "3gp": ["-c:v", "h263", "-q:v", "6", "-c:a", "aac"],
    m4v: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"],
    ogv: ["-c:v", "libtheora", "-q:v", "6", "-c:a", "libvorbis"],
    ts: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"],
  };
  for (const [ext, enc] of Object.entries(vidEnc)) {
    const out = path.join(dir, `vid.${ext}`);
    await ffmpegRun(["-i", mp4, ...enc, "-shortest", out]);
    s[ext] = out;
  }

  // ---- audio: make a wav, then encode to every other format ----
  const wav = path.join(dir, "aud.wav");
  makeWav(wav);
  s.wav = wav;
  const audEnc = {
    mp3: ["-c:a", "libmp3lame", "-b:a", "128k"],
    flac: ["-c:a", "flac"],
    ogg: ["-c:a", "libvorbis", "-q:a", "5"],
    oga: ["-c:a", "libvorbis", "-q:a", "5"],
    m4a: ["-c:a", "aac", "-b:a", "128k"],
    aac: ["-c:a", "aac", "-b:a", "128k"],
    wma: ["-c:a", "wmav2", "-b:a", "128k"],
    opus: ["-c:a", "libopus", "-b:a", "96k"],
    aiff: ["-c:a", "pcm_s16be"],
    aif: ["-c:a", "pcm_s16be"],
    ac3: ["-c:a", "ac3", "-b:a", "192k"],
    amr: ["-c:a", "libopencore_amrnb", "-b:a", "12k", "-ar", "8000", "-ac", "1"],
  };
  for (const [ext, enc] of Object.entries(audEnc)) {
    const out = path.join(dir, `aud.${ext}`);
    await ffmpegRun(["-i", wav, ...enc, out]);
    s[ext] = out;
  }

  // ---- documents ----
  const pdf = path.join(dir, "doc.pdf");
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  page.drawText("L2L matrix test page", { x: 40, y: 120, size: 16 });
  fs.writeFileSync(pdf, await doc.save());
  s.pdf = pdf;

  const txt = path.join(dir, "doc.txt");
  fs.writeFileSync(txt, "Hello L2L\n\nSecond paragraph with some words.");
  s.txt = txt;

  const md = path.join(dir, "doc.md");
  fs.writeFileSync(md, "# Heading\n\nSome **bold** and `code` here.\n\n- item a\n- item b\n");
  s.md = md;
  s.markdown = path.join(dir, "doc.markdown");
  fs.copyFileSync(md, s.markdown);

  const html = path.join(dir, "doc.html");
  fs.writeFileSync(html, "<!DOCTYPE html><html><body><h1>Title</h1><p>Hello <b>world</b>!</p></body></html>");
  s.html = html;
  s.htm = path.join(dir, "doc.htm");
  fs.copyFileSync(html, s.htm);

  const docx = path.join(dir, "doc.docx");
  const dx = new Document({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun({ text: "L2L docx", bold: true })] }),
          new Paragraph("Body text line."),
        ],
      },
    ],
  });
  fs.writeFileSync(docx, await Packer.toBuffer(dx));
  s.docx = docx;

  const csv = path.join(dir, "data.csv");
  fs.writeFileSync(csv, "name,value\nalpha,1\nbeta,2\n");
  s.csv = csv;

  const xlsx = path.join(dir, "data.xlsx");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["name", "value"]);
  ws.addRow(["alpha", 1]);
  await wb.xlsx.writeFile(xlsx);
  s.xlsx = xlsx;

  // ---- 3D models: STL first, then derive others through the converter ----
  const stl = path.join(dir, "mesh.stl");
  const stlLines = ["solid mesh"];
  const v = [
    [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0],
    [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10],
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0],
  ];
  for (const [a, b, c] of faces) {
    stlLines.push("  facet normal 0 0 1");
    stlLines.push("    outer loop");
    for (const i of [a, b, c]) {
      stlLines.push(`      vertex ${v[i][0]} ${v[i][1]} ${v[i][2]}`);
    }
    stlLines.push("    endloop");
    stlLines.push("  endfacet");
  }
  stlLines.push("endsolid mesh");
  fs.writeFileSync(stl, stlLines.join("\n"));
  s.stl = stl;

  for (const ext of ["obj", "ply", "3mf", "glb"]) {
    const out = path.join(dir, `mesh.${ext}`);
    await convertOne(stl, ext, dir);
    // convertJob may suffix duplicates; locate the produced file
    const found = fs.readdirSync(dir).filter((f) => f.endsWith(`.${ext}`));
    fs.copyFileSync(path.join(dir, found[0]), out);
    s[ext] = out;
  }

  return s;
}

// ------------------------------------------------------------
// 2. Run the full matrix
// ------------------------------------------------------------
async function main() {
  console.log("Generating sample files…");
  const s = await generateSamples();

  console.log("\n=== FULL MATRIX: every source × every declared target ===\n");
  const checked = new Set();
  for (const ext of ALL_EXTS) {
    const inputPath = s[ext];
    if (!inputPath || !fs.existsSync(inputPath)) {
      bad(`input generation failed for .${ext}`, new Error("no sample generated"));
      continue;
    }
    const targets = targetsFor(ext);
    if (targets.length === 0) {
      bad(`.${ext}`, new Error("declared in ALL_EXTS but targetsFor() returns []"));
      continue;
    }
    for (const t of targets) {
      const name = `${ext} → ${t.id}`;
      if (checked.has(name)) continue;
      checked.add(name);
      const outDir = path.join(tmp, "out", ext.replace(/[^a-z0-9]/gi, "_"), t.id);
      fs.mkdirSync(outDir, { recursive: true });
      try {
        await convertOne(inputPath, t.id, outDir);
        ok(name);
      } catch (err) {
        bad(name, err);
      }
    }
  }

  // every extension must actually be recognised by the dispatcher
  for (const ext of ALL_EXTS) {
    if (!targetsFor(ext).length && !fs.existsSync(s[ext])) {
      // already reported above
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  app.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("Matrix test crashed:", err);
  app.exit(1);
});
