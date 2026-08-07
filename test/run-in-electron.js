// ============================================================
// L2L — Converter test suite (runs inside Electron so that
// HTML→PDF via hidden BrowserWindow is also covered).
//   npm test
// ============================================================

const { app } = require("electron");

app.disableHardwareAcceleration();
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");
const { spawn } = require("node:child_process");
const http = require("node:http");
const ffmpegPath = require("ffmpeg-static");
const { Document, Packer, Paragraph, TextRun } = require("docx");

const { convertJob } = require("../dist-electron/electron/converters/index.js");

function ffmpegRun(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ["-hide_banner", "-nostdin", "-y", ...args]);
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-400)))));
  });
}

function makeWav(filePath, seconds = 1, freq = 440, sampleRate = 44100) {
  const n = Math.floor(seconds * sampleRate);
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "l2l-test-"));
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

async function assertConvert(job, expectExts) {
  const outputs = await convertJob(job, report);
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error("converter returned no outputs");
  }
  for (const p of outputs) {
    if (!fs.existsSync(p)) throw new Error(`output missing: ${p}`);
    if (fs.statSync(p).size === 0) throw new Error(`output is empty: ${p}`);
  }
  if (expectExts) {
    for (const p of outputs) {
      const e = path.extname(p).slice(1).toLowerCase();
      if (!expectExts.includes(e)) throw new Error(`unexpected extension .${e} in ${p}`);
    }
  }
  return outputs;
}

async function assertReject(job, text) {
  try {
    await convertJob(job, report);
  } catch (error) {
    if (!text || String(error.message || error).includes(text)) return;
    throw error;
  }
  throw new Error("converter accepted an unsafe input");
}

const run = async (name, fn) => {
  try {
    await fn();
    ok(name);
  } catch (err) {
    bad(name, err);
  }
};

async function makeSamples() {
  const png = path.join(tmp, "sample.png");
  await sharp({
    create: { width: 320, height: 200, channels: 3, background: { r: 124, g: 58, b: 237 } },
  })
    .png()
    .toFile(png);

  const svg = path.join(tmp, "sample.svg");
  fs.writeFileSync(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">' +
      '<rect width="200" height="100" fill="#22d3ee"/>' +
      '<circle cx="100" cy="50" r="32" fill="#8b5cf6"/></svg>',
  );

  // BMP: sharp/libvips here cannot decode BMP, so the converter must
  // normalize it through ffmpeg first — this sample exercises that path.
  const bmp = path.join(tmp, "sample.bmp");
  await ffmpegRun([
    "-f", "lavfi", "-i", "testsrc=duration=0.3:size=64x64:rate=5",
    "-frames:v", "1", bmp,
  ]);

  const pdf = path.join(tmp, "sample.pdf");
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  page.drawText("Hello L2L PDF", { x: 50, y: 240, size: 18 });
  fs.writeFileSync(pdf, await doc.save());

  const mp4 = path.join(tmp, "sample.mp4");
  await ffmpegRun([
    "-f", "lavfi", "-i", "color=c=0x2255ff:s=320x240:d=1",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest",
    mp4,
  ]);

  const wav = path.join(tmp, "sample.wav");
  makeWav(wav);

  const txt = path.join(tmp, "sample.txt");
  fs.writeFileSync(txt, "Hello L2L!\n\nSecond paragraph with some text.");

  const md = path.join(tmp, "sample.md");
  fs.writeFileSync(md, "# Title\n\nSome **bold** text here.\n\n- item one\n- item two\n");

  const csv = path.join(tmp, "sample.csv");
  fs.writeFileSync(csv, "name,age\nAda,30\nBuffy,25\n");

  const docx = path.join(tmp, "sample.docx");
  const d = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun("Hello from DOCX")] })] }],
  });
  fs.writeFileSync(docx, await Packer.toBuffer(d));

  // 3D sample: a small tetrahedron as ASCII STL
  const stl = path.join(tmp, "sample.stl");
  const tetVerts = [
    [0, 0, 0], [10, 0, 0], [5, 10, 0], [5, 3, 8],
  ];
  const tetFaces = [
    [0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3],
  ];
  const stlLines = ["solid l2l-test"];
  for (const f of tetFaces) {
    stlLines.push("  facet normal 0 0 0");
    stlLines.push("    outer loop");
    for (const v of f) {
      stlLines.push(`      vertex ${tetVerts[v][0]} ${tetVerts[v][1]} ${tetVerts[v][2]}`);
    }
    stlLines.push("    endloop");
    stlLines.push("  endfacet");
  }
  stlLines.push("endsolid l2l-test");
  fs.writeFileSync(stl, stlLines.join("\n"));

  return { png, svg, bmp, pdf, mp4, wav, txt, md, csv, docx, stl };
}

async function main() {
  await app.whenReady();
  console.log("\nL2L converter test suite\n");
  const s = await makeSamples();

  const job = (inputPath, target, quality = "normal") => ({
    id: Math.random().toString(36).slice(2),
    inputPath,
    target,
    quality,
    outputDir: tmp,
  });

  await run("PNG → JPG", () => assertConvert(job(s.png, "jpg"), ["jpg"]));
  await run("PNG → WebP", () => assertConvert(job(s.png, "webp"), ["webp"]));
  await run("PNG → AVIF", () => assertConvert(job(s.png, "avif"), ["avif"]));
  await run("PNG → TIFF", () => assertConvert(job(s.png, "tiff"), ["tiff"]));
  await run("SVG → PNG", () => assertConvert(job(s.svg, "png"), ["png"]));
  await run("PNG → PDF", () => assertConvert(job(s.png, "pdf"), ["pdf"]));
  // BMP is decoded via the bundled ffmpeg (sharp has no BMP loader here)
  await run("BMP → PNG", () => assertConvert(job(s.bmp, "png"), ["png"]));
  await run("BMP → ASCII", () => assertConvert(job(s.bmp, "ascii"), ["txt"]));
  await run("BMP → Remove BG", () => assertConvert(job(s.bmp, "removebg"), ["png"]));
  // MPEG-TS is intentionally unsupported (bundled ffmpeg segfaults on it)
  await run(".ts input is rejected cleanly", async () => {
    const ts = path.join(tmp, "sample.ts");
    fs.writeFileSync(ts, "dummy mpegts");
    return assertReject(job(ts, "mp4"), "Unsupported file type");
  });

  await run("MP4 → WebM", () => assertConvert(job(s.mp4, "webm"), ["webm"]));
  await run("MP4 → MP3 (audio extract)", () => assertConvert(job(s.mp4, "mp3"), ["mp3"]));
  await run("MP4 → GIF", () => assertConvert(job(s.mp4, "gif"), ["gif"]));
  await run("MP4 → MKV", () => assertConvert(job(s.mp4, "mkv"), ["mkv"]));
  await run("MP4 → MOV", () => assertConvert(job(s.mp4, "mov"), ["mov"]));
  await run("MP4 → AVI", () => assertConvert(job(s.mp4, "avi"), ["avi"]));
  await run("MP4 → MPEG", () => assertConvert(job(s.mp4, "mpeg"), ["mpeg"]));
  await run("MP4 → OGV", () => assertConvert(job(s.mp4, "ogv"), ["ogv"]));
  await run("WAV → MP3", () => assertConvert(job(s.wav, "mp3"), ["mp3"]));
  await run("WAV → FLAC", () => assertConvert(job(s.wav, "flac"), ["flac"]));
  await run("WAV → OGG", () => assertConvert(job(s.wav, "ogg"), ["ogg"]));
  await run("WAV → M4A", () => assertConvert(job(s.wav, "m4a"), ["m4a"]));
  await run("WAV → AAC", () => assertConvert(job(s.wav, "aac"), ["aac"]));
  await run("WAV → OPUS", () => assertConvert(job(s.wav, "opus"), ["opus"]));
  await run("WAV → AIFF", () => assertConvert(job(s.wav, "aiff"), ["aiff"]));
  await run("WAV → AC3", () => assertConvert(job(s.wav, "ac3"), ["ac3"]));

  await run("PDF → PNG", () => assertConvert(job(s.pdf, "png"), ["png"]));
  await run("PDF → TXT", () => assertConvert(job(s.pdf, "txt"), ["txt"]));
  await run("PDF → HTML", () => assertConvert(job(s.pdf, "html"), ["html"]));
  await run("TXT → PDF", () => assertConvert(job(s.txt, "pdf"), ["pdf"]));
  await run("TXT → HTML", () => assertConvert(job(s.txt, "html"), ["html"]));
  await run("TXT → Markdown", async () => {
    const [out] = await assertConvert(job(s.txt, "md"), ["md"]);
    const body = fs.readFileSync(out, "utf8");
    if (!body.includes("Hello L2L")) throw new Error("markdown output lost the text");
  });
  await run("MD → PDF", () => assertConvert(job(s.md, "pdf"), ["pdf"]));
  await run("MD → TXT", async () => {
    const [out] = await assertConvert(job(s.md, "txt"), ["txt"]);
    const body = fs.readFileSync(out, "utf8");
    if (!body.includes("item one")) throw new Error("markdown list text missing");
    if (body.includes("##")) throw new Error("markdown heading markup not stripped");
  });
  await run("HTML → TXT", async () => {
    const [out] = await assertConvert(job(s.md, "txt"), ["txt"]);
    if (!fs.readFileSync(out, "utf8").length) throw new Error("empty txt output");
    const html = path.join(tmp, "to-txt.html");
    fs.writeFileSync(html, "<html><body><h1>Hi</h1><p>Hello <b>world</b></p></body></html>");
    const [txt] = await assertConvert(job(html, "txt"), ["txt"]);
    const body = fs.readFileSync(txt, "utf8");
    if (!body.includes("Hello world")) throw new Error("html to txt lost text");
    if (body.includes("<p>")) throw new Error("html tags not stripped");
  });
  await run("HTML → Markdown", async () => {
    const html = path.join(tmp, "to-md.html");
    fs.writeFileSync(html, "<html><body><h1>Hi</h1><p>Some body text</p></body></html>");
    const [md] = await assertConvert(job(html, "md"), ["md"]);
    const body = fs.readFileSync(md, "utf8");
    if (!body.includes("Some body text")) throw new Error("html to markdown lost text");
  });
  await run("DOCX → PDF", () => assertConvert(job(s.docx, "pdf"), ["pdf"]));
  await run("DOCX → HTML", () => assertConvert(job(s.docx, "html"), ["html"]));
  await run("DOCX → TXT", () => assertConvert(job(s.docx, "txt"), ["txt"]));
  await run("DOCX → Markdown", async () => {
    const [md] = await assertConvert(job(s.docx, "md"), ["md"]);
    const body = fs.readFileSync(md, "utf8");
    if (!body.includes("Hello from DOCX")) throw new Error("docx to markdown lost text");
  });
  await run("HTML → PDF blocks remote subresources", async () => {
    let requests = 0;
    const server = http.createServer((_req, res) => {
      requests += 1;
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end("not-an-image");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const html = path.join(tmp, "remote-resource.html");
    fs.writeFileSync(html, `<html><body><h1>Local PDF</h1><img src="http://127.0.0.1:${port}/pixel.png"></body></html>`);
    try {
      await assertConvert(job(html, "pdf"), ["pdf"]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (requests !== 0) throw new Error(`remote resource was requested ${requests} time(s)`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
  await run("PNG → GIF", () => assertConvert(job(s.png, "gif"), ["gif"]));

  await run("Remove BG (solid background → transparent)", async () => {
    // 240x160 image: magenta background, opaque cyan circle in the middle
    const src = path.join(tmp, "bg-remove.png");
    const W = 240;
    const H = 160;
    const buf = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const dx = x - W / 2;
        const dy = y - H / 2;
        const inCircle = dx * dx + dy * dy < 45 * 45;
        if (inCircle) {
          buf[i] = 34;
          buf[i + 1] = 211;
          buf[i + 2] = 238;
        } else {
          buf[i] = 217;
          buf[i + 1] = 70;
          buf[i + 2] = 239;
        }
        buf[i + 3] = 255;
      }
    }
    await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(src);

    const [out] = await assertConvert(job(src, "removebg"), ["png"]);
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
    // corners must be (near) transparent, circle center must stay opaque
    if (alphaAt(4, 4) > 40) throw new Error(`corner alpha=${alphaAt(4, 4)}, expected ~0`);
    if (alphaAt(W - 5, H - 5) > 40) throw new Error(`corner alpha=${alphaAt(W - 5, H - 5)}, expected ~0`);
    if (alphaAt(W / 2, H / 2) < 200) throw new Error(`center alpha=${alphaAt(W / 2, H / 2)}, expected opaque`);
  });
  await run("PNG → ASCII art (.txt)", async () => {
    // 160x100: left half black, right half white → dark→'@', bright→' '
    const src = path.join(tmp, "ascii-src.png");
    const W = 160;
    const H = 100;
    const buf = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const v = x >= W / 2 ? 255 : 0;
        buf[i] = v;
        buf[i + 1] = v;
        buf[i + 2] = v;
        buf[i + 3] = 255;
      }
    }
    await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(src);

    const [out] = await assertConvert(job(src, "ascii"), ["txt"]);
    const text = fs.readFileSync(out, "utf8");
    const lines = text.trim().split("\n");
    if (lines.length < 15) throw new Error(`too few lines: ${lines.length}`);
    if (!lines[0].startsWith("@")) {
      throw new Error(`dark region should map to '@', got: ${JSON.stringify(lines[0].slice(0, 12))}`);
    }
    if (lines[0].length < 30) throw new Error(`first line too short: ${lines[0].length}`);
  });
  await run("STL → OBJ", () => assertConvert(job(s.stl, "obj"), ["obj"]));
  await run("STL → PLY", () => assertConvert(job(s.stl, "ply"), ["ply"]));
  await run("STL → 3MF", () => assertConvert(job(s.stl, "3mf"), ["3mf"]));
  await run("STL → GLB", () => assertConvert(job(s.stl, "glb"), ["glb"]));
  await run("3MF → STL (round trip)", async () => {
    const [mf] = await assertConvert(job(s.stl, "3mf"), ["3mf"]);
    const [stl2] = await assertConvert(job(mf, "stl"), ["stl"]);
    // binary STL: 80-byte header + 4-byte count; we wrote 4 triangles
    const buf = fs.readFileSync(stl2);
    const count = buf.readUInt32LE(80);
    if (count !== 4) throw new Error(`expected 4 triangles, got ${count}`);
  });
  await run("GLB → OBJ (round trip)", async () => {
    const [glb] = await assertConvert(job(s.stl, "glb"), ["glb"]);
    const [obj] = await assertConvert(job(glb, "obj"), ["obj"]);
    const faces = fs.readFileSync(obj, "utf8").split("\n").filter((l) => l.startsWith("f ")).length;
    if (faces !== 4) throw new Error(`expected 4 faces, got ${faces}`);
  });
  await run("PLY → OBJ", async () => {
    const [ply] = await assertConvert(job(s.stl, "ply"), ["ply"]);
    const [obj] = await assertConvert(job(ply, "obj"), ["obj"]);
    const faces = fs.readFileSync(obj, "utf8").split("\n").filter((l) => l.startsWith("f ")).length;
    if (faces !== 4) throw new Error(`expected 4 faces, got ${faces}`);
  });
  await run("CSV → XLSX", () => assertConvert(job(s.csv, "xlsx"), ["xlsx"]));
  await run("XLSX → CSV", async () => {
    const [xlsx] = await assertConvert(job(s.csv, "xlsx"), ["xlsx"]);
    return assertConvert({ ...job(xlsx, "csv"), outputDir: tmp }, ["csv"]);
  });
  await run("Concurrent same-name collision (no overwrite)", async () => {
    const dirA = path.join(tmp, "race-a");
    const dirB = path.join(tmp, "race-b");
    const outDir = path.join(tmp, "race-out");
    for (const d of [dirA, dirB, outDir]) fs.mkdirSync(d, { recursive: true });
    const a = path.join(dirA, "same.png");
    const b = path.join(dirB, "same.png");
    await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toFile(a);
    await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toFile(b);
    const make = (inputPath) => ({ id: Math.random().toString(36).slice(2), inputPath, target: "jpg", quality: "normal", outputDir: outDir });
    const [o1, o2] = await Promise.all([convertJob(make(a), report), convertJob(make(b), report)]);
    const paths = [...o1, ...o2];
    if (new Set(paths).size !== paths.length) {
      throw new Error("output paths collided: " + paths.join(", "));
    }
    for (const p of paths) {
      if (!fs.existsSync(p)) throw new Error("missing: " + p);
      if (fs.statSync(p).size === 0) throw new Error("empty: " + p);
    }
  });
  await run("Oversized input is rejected before parsing", async () => {
    const giant = path.join(tmp, "giant.png");
    fs.writeFileSync(giant, "x");
    fs.truncateSync(giant, 1024 * 1024 * 1024 + 1);
    await assertReject(job(giant, "jpg"), "1 GB safety limit");
  });
  await run("Malformed GLB chunk is rejected safely", async () => {
    const broken = path.join(tmp, "broken.glb");
    const buf = Buffer.alloc(20);
    buf.writeUInt32LE(0x46546c67, 0);
    buf.writeUInt32LE(2, 4);
    buf.writeUInt32LE(20, 8);
    buf.writeUInt32LE(8, 12); // claims an eight-byte chunk with no payload
    buf.writeUInt32LE(0x4e4f534a, 16);
    fs.writeFileSync(broken, buf);
    await assertReject(job(broken, "obj"), "GLB chunk length is invalid");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  app.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  app.exit(1);
});
