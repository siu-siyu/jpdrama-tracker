#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ROOT, REFRESH_HOURS, getCache, loadCache, refresh, isRefreshing, isStale } from "./src/store.mjs";
import { buildRss } from "./src/feed.mjs";
import { resolveEpisodes } from "./src/bili.mjs";
import { log } from "./src/util.mjs";

const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 7788);
// 默认监听所有网卡，手机连同一个 Wi-Fi 就能访问；只想本机用可设 HOST=127.0.0.1
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".apk": "application/vnd.android.package-archive",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const JSON_HEADERS = { "Content-Type": MIME[".json"], "Cache-Control": "no-store" };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}

const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), JSON_HEADERS);

// 豆瓣图床要求带 Referer，浏览器直接引用会被 418；这里由服务端代取并缓存
const IMG_CACHE = new Map();
const IMG_MAX = 160;

async function proxyImage(res, raw) {
  let target;
  try {
    target = new URL(raw);
  } catch {
    return send(res, 400, "bad image url");
  }
  if (target.protocol !== "https:" || !/\.doubanio\.com$/.test(target.hostname)) {
    return send(res, 403, "host not allowed");
  }

  const hit = IMG_CACHE.get(target.href);
  if (hit) {
    if (IMG_CACHE.delete(target.href)) IMG_CACHE.set(target.href, hit);
    return send(res, 200, hit.buf, { "Content-Type": hit.type, "Cache-Control": "public, max-age=86400" });
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://movie.douban.com/",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) return send(res, 502, "image fetch failed");
    const buf = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get("content-type") || "image/jpeg";
    IMG_CACHE.set(target.href, { buf, type });
    if (IMG_CACHE.size > IMG_MAX) IMG_CACHE.delete(IMG_CACHE.keys().next().value);
    send(res, 200, buf, { "Content-Type": type, "Cache-Control": "public, max-age=86400" });
  } catch {
    send(res, 502, "image fetch failed");
  }
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

async function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, "forbidden");
  try {
    const buf = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    if (ext === ".webmanifest" || ext === ".js") headers["Cache-Control"] = "no-cache";
    send(res, 200, buf, headers);
  } catch {
    send(res, 404, "not found");
  }
}

const server = http.createServer(async (req, res) => {
  const origin = "http://" + (req.headers.host || HOST + ":" + PORT);
  let url;
  try {
    url = new URL(req.url || "/", origin);
  } catch {
    return send(res, 400, "bad request");
  }
  const p = url.pathname;

  // 记录来自局域网设备的请求，便于排查「手机打不开」是防火墙还是别的
  const remote = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  if (remote && remote !== "127.0.0.1" && remote !== "::1") {
    fs.appendFile(
      path.join(ROOT, "data", "access.log"),
      new Date().toISOString() + " " + remote + " " + req.method + " " + req.url + "\n",
    ).catch(() => {});
  }

  try {
    if (p === "/api/data") {
      if (!getCache()) await refresh("first-request");
      return sendJson(res, 200, getCache() ?? {});
    }

    if (p === "/api/status") {
      const c = getCache();
      return sendJson(res, 200, {
        ok: Boolean(c),
        updatedAt: c?.updatedAt ?? null,
        stats: c?.stats ?? null,
        fresh: c?.fresh ?? null,
        warnings: c?.warnings ?? [],
        lastError: c?.lastError ?? "",
        refreshing: isRefreshing(),
        refreshHours: REFRESH_HOURS,
        sources: c?.sources ?? [],
        lan: lanAddresses().map((ip) => "http://" + ip + ":" + PORT),
      });
    }

    if (p === "/api/refresh" && req.method === "POST") {
      const data = await refresh("manual");
      return sendJson(res, 200, data ?? {});
    }

    if (p === "/api/episodes") {
      const kind = url.searchParams.get("kind") === "drama" ? "drama" : "anime";
      const id = url.searchParams.get("id") || "";
      const cache = getCache();
      const pool = kind === "drama" ? cache?.drama ?? [] : cache?.anime ?? [];
      const item = pool.find((x) => String(x.id) === String(id));
      if (!item) return sendJson(res, 404, { ok: false, reason: "not-found" });
      return sendJson(res, 200, await resolveEpisodes(item));
    }

    if (p === "/api/playable") {
      try {
        const raw = await fs.readFile(new URL("./data/playable.json", import.meta.url), "utf8");
        return sendJson(res, 200, JSON.parse(raw));
      } catch {
        return sendJson(res, 200, { count: 0, items: [] });
      }
    }

    if (p === "/feed.xml") {
      return send(res, 200, buildRss(getCache(), origin, REFRESH_HOURS), {
        "Content-Type": "application/rss+xml; charset=utf-8",
      });
    }

    if (p === "/img") {
      return await proxyImage(res, url.searchParams.get("u") || "");
    }

    if (p === "/healthz") return send(res, 200, "ok");

    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, "method not allowed");
    }
    return await serveStatic(res, p);
  } catch (err) {
    log("请求出错", p, err.message);
    send(res, 500, "server error");
  }
});

async function boot() {
  await loadCache();
  server.listen(PORT, HOST, () => {
    log("日漫日剧中文追番站 · 本机 http://127.0.0.1:" + PORT);
    if (HOST === "0.0.0.0") {
      for (const ip of lanAddresses()) log("           手机访问 http://" + ip + ":" + PORT + "（同一 Wi-Fi）");
    }
    log("自动刷新间隔 " + REFRESH_HOURS + " 小时 · RSS: /feed.xml");
  });

  if (isStale()) {
    log("缓存缺失或过期，后台拉取中…");
    refresh("boot").catch(() => {});
  } else {
    log("使用本地缓存", getCache().updatedAt);
  }

  setInterval(() => refresh("schedule").catch(() => {}), REFRESH_HOURS * 3600 * 1000).unref();
}

boot().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    log("收到 " + sig + "，关闭中");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1200).unref();
  });
}
