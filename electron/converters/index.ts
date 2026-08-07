// ============================================================
// L2L — Conversion registry & dispatcher
// Validates every job before touching the disk.
// ============================================================

import type { ConvertJob } from "../../shared/ipc";
import { extOf, kindOf, targetsFor } from "../../shared/formats";
import { assertSafeInput, assertSafeOutputDir, releaseReservedPaths, Reporter } from "./common";
import { convertImage } from "./images";
import { convertVideo, convertAudio } from "./media";
import { convertModel } from "./model3d";
import {
  DocJob,
  htmlFileToX,
  pdfToHtml,
  pdfToImages,
  pdfToText,
  textOrMarkdownToOutput,
  docxToOutput,
  csvToXlsx,
  xlsxToCsv,
} from "./documents";

const VALID_QUALITIES = ["low", "normal", "high", "lossless"];

/**
 * Validates and executes a single conversion job.
 * Returns the list of produced output file paths.
 * NEVER modifies or deletes the source file.
 */
export async function convertJob(job: ConvertJob, report: Reporter): Promise<string[]> {
  // ---- input validation (security) ----
  if (!job || typeof job !== "object") throw new Error("Invalid job payload.");
  if (typeof job.inputPath !== "string") throw new Error("Missing input path.");
  if (typeof job.target !== "string") throw new Error("Missing target format.");
  if (!VALID_QUALITIES.includes(job.quality)) throw new Error("Invalid quality setting.");

  const inputPath = assertSafeInput(job.inputPath);
  const ext = extOf(inputPath);
  const kind = kindOf(ext);
  if (!kind) throw new Error(`Unsupported file type: .${ext}`);

  // target must be in the whitelist for this source type
  const allowedTargets = targetsFor(ext).map((t) => t.id);
  if (!allowedTargets.includes(job.target)) {
    throw new Error(`"${job.target}" is not a valid target for .${ext} files.`);
  }

  const outputDir = assertSafeOutputDir(job.outputDir, inputPath);

  const opts: DocJob = {
    inputPath,
    target: job.target,
    quality: job.quality,
    outputDir,
    report,
  };

  let outputs: string[] = [];
  try {
  switch (kind) {
    case "image":
      outputs = await convertImage(opts);
      break;
    case "video":
      outputs = await convertVideo(opts);
      break;
    case "audio":
      outputs = await convertAudio(opts);
      break;
    case "model":
      outputs = await convertModel(opts);
      break;
    case "document":
      switch (ext) {
        case "pdf":
          if (job.target === "txt") return await pdfToText(opts);
          if (job.target === "html") return await pdfToHtml(opts);
          return await pdfToImages(opts);
        case "txt":
        case "md":
        case "markdown":
          return await textOrMarkdownToOutput(opts);
        case "html":
        case "htm":
          return await htmlFileToX(opts);
        case "docx":
          return await docxToOutput(opts);
        case "csv":
          return await csvToXlsx(opts);
        case "xlsx":
          return await xlsxToCsv(opts);
        default:
          throw new Error(`Unsupported document source: .${ext}`);
      }
  }
  return outputs;
  } finally {
    // Reservations only protect concurrent writes. After a job settles the
    // filesystem itself is the source of truth, so do not retain memory.
    releaseReservedPaths(outputs);
  }
}
