// ============================================================
// L2L — Document converters
// PDF → images/text · TXT/MD → PDF/HTML · HTML → PDF
// DOCX → PDF/HTML/TXT · CSV ↔ XLSX
// ============================================================

import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import mammoth from "mammoth";
import MarkdownIt from "markdown-it";
import ExcelJS from "exceljs";

import type { Quality } from "../../shared/formats";
import { extOf, baseNameOf } from "../../shared/formats";
import { QUALITY_META, Reporter, uniquePath } from "./common";
import { htmlToPdf } from "./html2pdf";

const MAX_PDF_PAGES = 250;
const MAX_PDF_RENDER_PIXELS = 80_000_000;
// PDF.js' Node font loader expects a filesystem directory, not a file:// URL.
const standardFontDataUrl = path.join(
  path.dirname(require.resolve("pdfjs-dist/package.json")),
  "standard_fonts",
  path.sep,
);

function loadPdf(data: Uint8Array) {
  return pdfjsLib.getDocument({ data, standardFontDataUrl } as never).promise;
}

export interface DocJob {
  inputPath: string;
  target: string;
  quality: Quality;
  outputDir: string;
  report: Reporter;
  color?: string;
}

// ------------------------------------------------------------
// PDF → images (PNG / JPG / WebP)
// ------------------------------------------------------------
export async function pdfToImages(opts: DocJob): Promise<string[]> {
  const { inputPath, target, quality, outputDir, report } = opts;
  const base = baseNameOf(inputPath);
  const scale = QUALITY_META[quality].pdfScale;
  const data = new Uint8Array(fs.readFileSync(inputPath));

  const doc = await loadPdf(data);

  const total = doc.numPages;
  if (total > MAX_PDF_PAGES) {
    throw new Error(`This PDF has ${total} pages; L2L's safety limit is ${MAX_PDF_PAGES}.`);
  }
  const outputs: string[] = [];

  for (let p = 1; p <= total; p++) {
    report({
      percent: Math.round(((p - 1) / total) * 92),
      stage: `Rendering page ${p} of ${total}…`,
      pages: { done: p - 1, total },
    });

    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale });
    if (viewport.width * viewport.height > MAX_PDF_RENDER_PIXELS) {
      throw new Error(`Page ${p} is too large to render safely.`);
    }
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport } as never).promise;

    let buffer: Buffer = canvas.toBuffer("image/png");
    const outExt = target === "jpg" ? "jpg" : target;
    if (target === "jpg") {
      buffer = await sharp(buffer).jpeg({ quality: QUALITY_META[quality].imageQuality }).toBuffer();
    } else if (target === "webp") {
      buffer = await sharp(buffer).webp({ quality: QUALITY_META[quality].imageQuality }).toBuffer();
    }

    const outputPath = uniquePath(outputDir, `${base}-page${p}`, outExt);
    fs.writeFileSync(outputPath, buffer);
    outputs.push(outputPath);

    report({
      percent: Math.round((p / total) * 92),
      pages: { done: p, total },
    });
  }

  report({ percent: 100, stage: "Done" });
  return outputs;
}

// ------------------------------------------------------------
// PDF → plain text
// ------------------------------------------------------------
export async function pdfToText(opts: DocJob): Promise<string[]> {
  const { inputPath, outputDir, report } = opts;
  const base = baseNameOf(inputPath);
  const data = new Uint8Array(fs.readFileSync(inputPath));

  const plainText = await extractPdfText(data, report);

  const outputPath = uniquePath(outputDir, base, "txt");
  fs.writeFileSync(outputPath, plainText);
  report({ percent: 100, stage: "Done" });
  return [outputPath];
}

/**
 * Extracts plain text from a PDF, reporting per-page progress.
 * Shared by PDF → TXT and PDF → HTML so both see identical text.
 */
async function extractPdfText(data: Uint8Array, report: Reporter): Promise<string> {
  const doc = await loadPdf(data);
  if (doc.numPages > MAX_PDF_PAGES) {
    throw new Error(`This PDF has ${doc.numPages} pages; L2L's safety limit is ${MAX_PDF_PAGES}.`);
  }

  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it && typeof it.str === "string" ? it.str : ""))
      .join(" ");
    pages.push(text);
    report({ percent: Math.round((p / doc.numPages) * 100), stage: `Extracting page ${p}…` });
  }
  return pages.join("\n\n");
}

// ------------------------------------------------------------
// Plain text / ASCII art → PNG image (rendered via sharp + SVG)
// Any .txt works; ASCII-art files keep their monospace layout.
// ------------------------------------------------------------
const TEXT_IMG_FONT_SIZE = 20;
const TEXT_IMG_CHAR_RATIO = 0.6; // monospace advance width per em
const TEXT_IMG_LINE_RATIO = 1.18; // line box per em
const TEXT_IMG_MAX_WIDTH = 4096;
const TEXT_IMG_MAX_HEIGHT = 8192;
const TEXT_IMG_BG = "#0d1117"; // terminal-style dark background
const TEXT_IMG_FG = "#e6edf3";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Renders a plain-text file (incl. ASCII art) into a PNG image. */
export async function textToImage(opts: DocJob): Promise<string[]> {
  const { inputPath, outputDir, report } = opts;
  const base = baseNameOf(inputPath);
  const text = fs.readFileSync(inputPath, "utf8").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  // Files usually end with a trailing newline; drop the phantom blank row.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  const rows = Math.max(lines.length, 1);
  const cols = Math.max(...lines.map((l) => l.length), 1);

  // Pick a font size that keeps the image within sane bounds.
  let fontSize = TEXT_IMG_FONT_SIZE;
  let width = Math.ceil(cols * fontSize * TEXT_IMG_CHAR_RATIO);
  let height = Math.ceil(rows * fontSize * TEXT_IMG_LINE_RATIO);
  while ((width > TEXT_IMG_MAX_WIDTH || height > TEXT_IMG_MAX_HEIGHT) && fontSize > 6) {
    fontSize -= 1;
    width = Math.ceil(cols * fontSize * TEXT_IMG_CHAR_RATIO);
    height = Math.ceil(rows * fontSize * TEXT_IMG_LINE_RATIO);
  }
  if (width > TEXT_IMG_MAX_WIDTH || height > TEXT_IMG_MAX_HEIGHT) {
    throw new Error("This text file is too large to render as an image.");
  }

  report({ percent: 60, stage: "Rendering text → image…" });

  // One <text> per line; xml:space="preserve" keeps the spaces that shape
  // ASCII art intact, and librsvg resolves monospace via fontconfig.
  const glyphs = lines
    .map((line, i) => {
      const y = Math.ceil((i + 1) * fontSize * TEXT_IMG_LINE_RATIO);
      return `<text x="0" y="${y}" xml:space="preserve" font-family="'DejaVu Sans Mono','Courier New',monospace" font-size="${fontSize}" fill="${TEXT_IMG_FG}">${escapeXml(line)}</text>`;
    })
    .join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="${TEXT_IMG_BG}"/>
${glyphs}
</svg>`;

  const outputPath = uniquePath(outputDir, base, "png");
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  report({ percent: 100, stage: "Done" });
  return [outputPath];
}

// ------------------------------------------------------------
// Plain text / Markdown → PDF or HTML
// ------------------------------------------------------------
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrapHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>L2L document</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         margin: 0; padding: 40px; color: #16181d; line-height: 1.65; }
  .doc { max-width: 720px; margin: 0 auto; }
  pre { background: #f2f3f5; padding: 14px; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; }
  code { background: #f2f3f5; padding: 2px 5px; border-radius: 4px; font-size: 0.9em; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #d4d6da; padding: 6px 10px; text-align: left; }
  img { max-width: 100%; }
  h1, h2, h3 { line-height: 1.25; }
</style>
</head>
<body><div class="doc">${body}</div></body>
</html>`;
}

function textToHtml(text: string): string {
  const safe = escapeHtml(text);
  const paragraphs = safe
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return wrapHtml(`<article>${paragraphs}</article>`);
}

function markdownToHtml(md: string): string {
  const mdIt = new MarkdownIt({ html: false, linkify: true, breaks: false });
  return wrapHtml(mdIt.render(md));
}

/** Loose but practical HTML → plain text (no external parser needed). */
function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Renders Markdown to HTML then to plain text (for md → txt / md → html). */
function markdownToText(md: string): string {
  const html = new MarkdownIt({ html: false, linkify: true, breaks: false }).render(md);
  return stripHtmlToText(html);
}

export async function textOrMarkdownToOutput(opts: DocJob): Promise<string[]> {
  const { inputPath, target, outputDir, report } = opts;
  const base = baseNameOf(inputPath);
  const ext = extOf(inputPath);
  const text = fs.readFileSync(inputPath, "utf8");
  const isMd = ext === "md" || ext === "markdown";

  report({ percent: 40, stage: "Building document…" });

  // TXT → PNG renders the raw text (incl. ASCII art) into an image.
  if (target === "png") {
    return await textToImage(opts);
  }

  // Any plain-text file is already valid Markdown, so TXT → MD is a copy.
  if (target === "md") {
    const outputPath = uniquePath(outputDir, base, "md");
    fs.writeFileSync(outputPath, text);
    report({ percent: 100, stage: "Done" });
    return [outputPath];
  }

  // MD → TXT strips Markdown markup down to readable plain text.
  if (target === "txt") {
    const outputPath = uniquePath(outputDir, base, "txt");
    fs.writeFileSync(outputPath, isMd ? markdownToText(text) : text);
    report({ percent: 100, stage: "Done" });
    return [outputPath];
  }

  const html = isMd ? markdownToHtml(text) : textToHtml(text);

  if (target === "html") {
    const outputPath = uniquePath(outputDir, base, "html");
    fs.writeFileSync(outputPath, html);
    report({ percent: 100, stage: "Done" });
    return [outputPath];
  }

  const outputPath = uniquePath(outputDir, base, "pdf");
  await htmlToPdf(html, outputPath);
  report({ percent: 100, stage: "Done" });
  return [outputPath];
}

// ------------------------------------------------------------
// HTML file → PDF / TXT / Markdown
// ------------------------------------------------------------
export async function htmlFileToX(opts: DocJob): Promise<string[]> {
  const { inputPath, target, outputDir, report } = opts;
  const html = fs.readFileSync(inputPath, "utf8");
  const base = baseNameOf(inputPath);

  if (target === "txt") {
    const outputPath = uniquePath(outputDir, base, "txt");
    fs.writeFileSync(outputPath, stripHtmlToText(html));
    report({ percent: 100, stage: "Done" });
    return [outputPath];
  }

  if (target === "md") {
    const outputPath = uniquePath(outputDir, base, "md");
    fs.writeFileSync(outputPath, stripHtmlToText(html));
    report({ percent: 100, stage: "Done" });
    return [outputPath];
  }

  const outputPath = uniquePath(outputDir, base, "pdf");
  await htmlToPdf(html, outputPath);
  report({ percent: 100, stage: "Done" });
  return [outputPath];
}

/**
 * PDF → HTML: extracts the same text as PDF → TXT, then wraps it in the
 * shared printable document template.
 */
export async function pdfToHtml(opts: DocJob): Promise<string[]> {
  const { inputPath, outputDir, report } = opts;
  const base = baseNameOf(inputPath);
  const data = new Uint8Array(fs.readFileSync(inputPath));

  const text = await extractPdfText(data, report);
  const paragraphs = escapeHtml(text)
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

  const outputPath = uniquePath(outputDir, base, "html");
  fs.writeFileSync(outputPath, wrapHtml(`<article>${paragraphs}</article>`));
  report({ percent: 100, stage: "Done" });
  return [outputPath];
}

// ------------------------------------------------------------
// DOCX → PDF / HTML / TXT
// ------------------------------------------------------------
export async function docxToOutput(opts: DocJob): Promise<string[]> {
  const { inputPath, target, outputDir, report } = opts;
  const base = baseNameOf(inputPath);

  if (target === "txt") {
    const result = await mammoth.extractRawText({ path: inputPath });
    const outputPath = uniquePath(outputDir, base, "txt");
    fs.writeFileSync(outputPath, result.value);
    report({ percent: 100, stage: "Done" });
    return [outputPath];
  }

  const result = await mammoth.convertToHtml({ path: inputPath });
  report({ percent: 50, stage: "Converting document…" });

  if (target === "md") {
    const outputPath = uniquePath(outputDir, base, "md");
    fs.writeFileSync(outputPath, stripHtmlToText(result.value));
    report({ percent: 100, stage: "Done" });
    return [outputPath];
  }

  if (target === "html") {
    const outputPath = uniquePath(outputDir, base, "html");
    fs.writeFileSync(outputPath, wrapHtml(result.value));
    report({ percent: 100, stage: "Done" });
    return [outputPath];
  }

  const outputPath = uniquePath(outputDir, base, "pdf");
  await htmlToPdf(wrapHtml(result.value), outputPath);
  report({ percent: 100, stage: "Done" });
  return [outputPath];
}

// ------------------------------------------------------------
// CSV ↔ XLSX
// ------------------------------------------------------------
export async function csvToXlsx(opts: DocJob): Promise<string[]> {
  const { inputPath, outputDir, report } = opts;
  const workbook = new ExcelJS.Workbook();
  await workbook.csv.readFile(inputPath);
  const outputPath = uniquePath(outputDir, baseNameOf(inputPath), "xlsx");
  await workbook.xlsx.writeFile(outputPath);
  report({ percent: 100, stage: "Done" });
  return [outputPath];
}

export async function xlsxToCsv(opts: DocJob): Promise<string[]> {
  const { inputPath, outputDir, report } = opts;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The spreadsheet contains no worksheets.");
  const outputPath = uniquePath(outputDir, baseNameOf(inputPath), "csv");
  await workbook.csv.writeFile(outputPath, { sheetId: sheet.id });
  report({ percent: 100, stage: "Done" });
  return [outputPath];
}
