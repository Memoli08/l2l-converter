# Contributing to L2L Converter

Thanks for considering a contribution! 🎉 L2L's promise is *local-first, safe,
predictable conversion* — please keep that promise in mind in every PR.

## 🧑‍💻 Getting started

Requirements: **Node.js 20+** on Linux, macOS or Windows.

```bash
npm install
npm run dev            # hot-reload dev environment (Next.js + Electron)
```

> `npm run dev` starts a browser preview at `localhost:3000` **and** an
> Electron window. The browser preview cannot touch local files — real
> conversions happen in the desktop shell. For a production-style launch use
> `npm start`.

## 🏗️ Where things live

| Area | Location | Notes |
| --- | --- | --- |
| Renderer UI | `components/`, `app/` | React, Tailwind, client components only |
| Format matrix (single source of truth) | `shared/formats.ts` | extension → kind → allowed targets |
| IPC contracts | `shared/ipc.ts` | shared by renderer & main |
| Preload bridge | `electron/preload.ts` | the **only** renderer→main channel |
| Main process | `electron/main.ts` | window, IPC handling, static server |
| Converter engines | `electron/converters/` | `images.ts`, `media.ts`, `documents.ts`, `model3d.ts`, `background.ts`, `ascii.ts` |
| Tests | `test/` | Electron-run suite + format-matrix test |

Read [ARCHITECTURE.md](ARCHITECTURE.md) before touching the conversion path —
it documents the security boundaries that must not be weakened.

## ✅ Before opening a pull request

1. **Add or update a test** for every converter change:
   - converter behavior → `test/run-in-electron.js` (uses `convertJob` directly)
   - a new format pair → extend `test/matrix-test.js`
2. **Run the full checks:**
   ```bash
   npm test               # converter suite (56 tests)
   npm run test:matrix    # every source × every target (366 conversions)
   npm run build          # typecheck + production build
   npm audit --omit=dev   # production dependency security
   ```
3. **Keep the privacy model intact.** Do not add network requests, cloud SDKs,
   remote fonts, analytics or telemetry without an explicit documented
   privacy-model change.
4. **Validate everything untrusted** in new converters: input paths, target
   formats, output paths, and resource use (add defensive limits like the
   existing size/pixel/page caps).
5. **Preserve accessibility & polish:** keyboard focus, `prefers-reduced-motion`
   support, semantic category colors and the unified mark/branding.
6. Run the app once and convert at least one file of the type you touched.

## 🧪 Testing tips

- The suite runs inside Electron because HTML→PDF uses a hidden BrowserWindow.
- Slow media tests are avoided on purpose: prefer small synthetic samples
  (a 1-second WAV, a 1-second `testsrc` video, a tiny tetrahedron STL).
- If a test is flaky in CI, it will fail there too — `xvfb-run -a npm test` is
  what GitHub Actions runs.

## 💬 Commit & PR conventions

- Write clear, imperative commit messages: `Add WebP animation export`,
  `Fix BMP input decoding`, `Harden PDF text extraction`.
- One logical change per PR; keep the diff small and reviewable.
- Reference the issue your PR closes, e.g. `Closes #12`.
- In the PR description: what changed, why, how you tested it, and a
  screenshot if the UI changed.

## 🐛 Issue reports

Use the [issue templates](.github/ISSUE_TEMPLATE/) if you can — a great report
includes the file type, target format, expected vs. actual output, and (for
crashes) the error text. **Never post secrets or personal files in an issue.**

## 🙏 Thank you

Every PR, review and issue makes L2L better. If you're unsure where to start,
look for the `good first issue` label — or ask in an issue thread first!
