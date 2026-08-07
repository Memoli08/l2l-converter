// ============================================================
// L2L — Local static server for the Next.js export
// Next's static export references assets with ABSOLUTE paths
// (/_next/static/...) which break under file:// (they resolve to
// the filesystem root → CSS/JS 404 → black screen). Serving the
// out/ folder over http://127.0.0.1 fixes this cleanly.
//
// Security: binds to loopback only, serves files strictly from
// the export root (path-traversal guarded), no listing.
// ============================================================

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

export interface StaticServer {
  url: string;
  close(): void;
}

export function serveStatic(rootDir: string): Promise<StaticServer> {
  const root = path.resolve(rootDir);

  const server = http.createServer((req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain" });
        res.end("Method not allowed");
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";

      const filePath = path.resolve(root, "." + pathname);

      // path traversal guard: never serve anything outside the export root
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME[ext] ?? "application/octet-stream",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
        });
        res.end(req.method === "HEAD" ? undefined : data);
      });
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad request");
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
      });
    });
  });
}
