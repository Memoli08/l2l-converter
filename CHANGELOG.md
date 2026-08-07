# 📜 Changelog

All notable changes to L2L Converter are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### ✨ Added
- **Remove Background** (`removebg` target): one-click flood-fill background
  removal to transparent PNG, fully local, no model download.
- **ASCII Art** (`ascii` target): photo → monospace `.txt` art with 2×
  supersampling, block averaging and automatic contrast stretching.
- Full **format-matrix test** (`npm run test:matrix`): every supported input ×
  every declared target verified with real generated samples (366 conversions).
- Clickable **workflow showcase** in the UI — picking *ASCII Art* or
  *Remove BG* pre-selects that target for photos dropped afterwards.
- BMP input support via bundled FFmpeg normalization (sharp cannot decode BMP
  in this build).
- Unified app icon (menu, window and in-app header all share one design).

### 🔧 Fixed
- BMP files previously failed with "unsupported image format" on every target.
- `.ts` (MPEG-TS) input removed from the format matrix: the bundled FFmpeg
  binary segfaults (SIGSEGV) in its MPEG-TS demuxer, so `.ts` files can't be
  converted safely. Files are now rejected cleanly instead of crashing.
- Launcher now falls back to `--no-sandbox` when the SUID sandbox helper is
  not configured (user-level installs) — the app opens from the app menu and
  desktop shortcuts again.
- Sharp raw-buffer stride handling in the background-removal pipeline
  (3-channel quirk) — masks now align correctly on full-resolution output.
- Caps added for oversized images, huge 3MF expansions and ASCII output height.

## [1.0.0] - 2026-08-07

### ✨ Added
- Electron + Next.js desktop app with static export and loopback static server.
- Batch conversion queue with 2 concurrent workers and live per-file progress.
- Image conversion (PNG · JPG · WebP · GIF · AVIF · TIFF · PDF) via sharp.
- Video & audio conversion (MP4 · WebM · MKV · MOV · AVI · MPEG · OGV · GIF ·
  MP3 and MP3 · WAV · FLAC · OGG · M4A · AAC · OPUS · AIFF · AC3) via bundled
  FFmpeg.
- Document conversion: PDF → images/text/HTML, TXT/Markdown/HTML/DOCX → PDF,
  CSV ↔ XLSX.
- 3D mesh conversion between STL · OBJ · PLY · 3MF · GLB (pure TypeScript).
- Defensive limits: input size, decoded pixels, PDF pages, 3MF expansion,
  FFmpeg runtime and captured output.
- Security model: sandboxed renderer, typed preload bridge, path-traversal
  guards, no-overwrite output naming, remote-resource-blocked PDF rendering.
- One-click Linux installer (`scripts/install-linux.sh`) with app-menu entry,
  icon and desktop shortcut.
