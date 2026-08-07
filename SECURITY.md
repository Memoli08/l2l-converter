# 🔒 Security Policy

L2L Converter performs all conversion locally and contains no cloud
conversion endpoint, no analytics and no telemetry client. We still take
security seriously — especially because the app parses **untrusted files**
(media, documents and meshes) that users may have downloaded from anywhere.

## 🛡️ Supported versions

Only the **latest released version** of L2L receives security fixes.
Always update to the newest release before reporting.

## 📮 Reporting a vulnerability

**Please do not publish a working exploit in a public issue.**

Contact the maintainer named in the GitHub repository with:

- a clear description of the issue,
- the affected version(s),
- reproduction steps (file type, target, exact steps),
- a minimal, safe proof of concept if possible.

Your report will be acknowledged within **seven days** and handled privately
until a fix is available. If you prefer, you can use GitHub's private
vulnerability reporting feature on the repository page (Security → Report a
vulnerability).

## 🗂️ Local privacy model

- Conversion never leaves the device — there is no upload, account or API.
- PDF rendering (HTML/Markdown/DOCX → PDF) **blocks remote subresources**:
  network images, stylesheets and frames are not loaded.
- The only persistent preference is the **most recently selected output
  folder**, stored in the OS app-data directory and clearable in the UI.
- Inputs and outputs stay exactly where the user selects them.

## 🧱 Defensive limits

Untrusted parsers can consume substantial memory. L2L therefore caps:

| Resource | Limit |
| --- | --- |
| Input file size | 1 GB |
| Decoded image pixels | 80 MP (pixel-bomb guard) |
| PDF pages / render size | 250 pages · 80 MP per page |
| 3D model size / 3MF expansion | 128 MB file · 256 MB unpacked |
| FFmpeg run duration | 2 hours (safety kill) |
| Captured process output | 512 KB stderr buffer |

These limits trade support for extremely unusual giant files in exchange for a
much safer desktop process — a deliberate, documented trade-off.

## 🤝 Responsible disclosure

We believe in coordinated disclosure. If you have a solid, reproducible
finding, we will work with you to understand it, fix it, and credit you in the
release notes (with your permission). Thank you for helping keep L2L safe. ❤️
