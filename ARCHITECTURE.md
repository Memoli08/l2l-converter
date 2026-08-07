# 🏗️ L2L Architecture

> A **static Next.js renderer inside Electron**, with every filesystem
> operation and converter owned by the main process. The renderer talks to the
> outside world through exactly eight typed bridge operations — nothing more.

## 📑 Contents

- [Runtime model](#runtime-model)
- [Security boundaries](#security-boundaries)
- [Conversion pipeline](#conversion-pipeline)
- [UI system](#ui-system)
- [Packaging](#packaging)
- [Test strategy](#test-strategy)

---

## Runtime model

L2L is a static Next.js renderer inside Electron. The renderer has **no
Node.js access**. A loopback-only static server serves the exported UI so Next
assets work without `file://` path issues; the Electron main process owns every
filesystem operation and converter.

```
Renderer (React) → typed preload bridge → Electron main → converter engines
                                                └──────→ local output files
```

The app exposes **eight narrow bridge operations**: selecting files, selecting
an output folder, reading/writing the output-folder preference, starting a job,
receiving progress, revealing a known output and getting a dropped file path.
There is no generic `send`, no filesystem API and no shell escape hatch.

## Security boundaries

- `contextIsolation`, renderer sandboxing and disabled Node integration are on.
- The app calls `app.enableSandbox()` and the Linux launcher never adds
  `--no-sandbox`.
- Navigation and new windows are denied outside L2L's loopback UI.
- IPC accepts only the main window's sender and validates all job fields.
- The preload bridge contains no generic `send`, filesystem or shell API.
- HTML-to-PDF uses a separate sandboxed partition. Only `file:` and `data:`
  resources are allowed; remote URLs are blocked before loading.
- The static server binds to `127.0.0.1`, rejects non-GET/HEAD methods, blocks
  traversal and emits `nosniff`/same-origin headers.
- `revealFile` only accepts output paths created in the current session.

## Conversion pipeline

`shared/formats.ts` is the **single source of truth** for accepted extensions
and allowed targets. `electron/converters/index.ts` validates an input file,
validates its target against that table and chooses a converter. The renderer
runs at most two jobs concurrently.

```
job → validate input path → whitelist target → reserve output name
    → converter engine → unique output file(s) → release reservation
```

Converters use bundled or local libraries:

| Engine | Used for |
| --- | --- |
| `sharp` | images, background removal, ASCII preprocessing |
| bundled FFmpeg/FFprobe | video & audio (spawned directly, no shell) |
| PDF.js · pdf-lib · Mammoth · Markdown-It · ExcelJS | documents |
| pure TypeScript parsers/writers | STL · OBJ · PLY · 3MF · GLB (no native deps) |

No converter uses a cloud service. Resource limits are deliberate: inputs are
limited to **1 GiB**, decoded images to **80 MP**, PDFs to **250 pages** (and
rendered pages to 80 MP), 3D files to **128 MiB**, unpacked 3MF data to
**256 MiB**. FFmpeg jobs time out after **two hours** and cap captured error
output at 512 KB.

> **BMP note:** the prebuilt `sharp`/libvips in this project cannot decode BMP,
> so `convertImage` normalizes BMP through the always-bundled FFmpeg into a
> temporary PNG first (cleaned up afterwards).
>
> **`.ts` note:** MPEG-TS is intentionally absent from the format matrix —
> the bundled FFmpeg binary segfaults in its MPEG-TS demuxer. `.ts` files are
> rejected cleanly rather than crashing the conversion.

## UI system

The desktop UI uses a dark blue-charcoal surface with a teal action accent.
Category colors remain semantic: 🟢 green images, 🌹 rose video, 🟡 amber audio,
🔵 blue documents, 🟠 orange 3D, 🪄 fuchsia background removal and 🔷 cyan
ASCII art. Motion is limited to queue entry, drag feedback, progress and status
transitions; the global `prefers-reduced-motion` media query removes it for
accessibility.

## Packaging

Electron Builder creates **Linux AppImage and ZIP** artifacts, Windows NSIS
builds and macOS DMGs. The Linux installer copies the unpacked release to the
user's local data directory and registers a desktop entry with the bundled
transform icon. Publishing should include **SHA-256 checksums** and, where
available, signed artifacts.

## Test strategy

`npm test` compiles Electron then runs local converter integration tests inside
an Electron process (HTML→PDF needs a hidden BrowserWindow). `npm run
test:matrix` additionally generates a real sample for **every** supported
extension and converts it to **every** declared target — a full cross-check
that the UI's format matrix matches what the engines can actually do.

Before a release, add malformed/oversized samples for each parser, UI queue
tests and an IPC test that confirms unsupported renderer calls are rejected.
