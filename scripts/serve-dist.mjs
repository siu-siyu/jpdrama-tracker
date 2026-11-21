#!/usr/bin/env node
// 本地预览 dist/：node scripts/serve-dist.mjs  → http://127.0.0.1:7799
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../src/store.mjs";

const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT || 7799);
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".apk": "application/vnd.android.package-archive",
};

http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url || "/", "http://x").pathname);
  if (p === "/") p = "/index.html";
  const file = path.join(DIST, p);
  if (!file.startsWith(DIST)) { res.writeHead(403).end("forbidden"); return; }
  try {
    const buf = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log("静态站预览 http://127.0.0.1:" + PORT + "/");
});
