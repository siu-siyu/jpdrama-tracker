#!/usr/bin/env node
/**
 * 把「跑在电脑上的追踪站」导出成纯静态站点（dist/），可直接托管到 Cloudflare Pages / Netlify / 任何静态空间。
 *
 *   node scripts/build-static.mjs          用已有缓存导出（快，几秒）
 *   node scripts/build-static.mjs --fetch  先联网刷新一次豆瓣数据再导出（慢，几分钟）
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, getCache, loadCache, refresh } from "../src/store.mjs";
import { resolveEpisodes } from "../src/bili.mjs";

const DIST = path.join(ROOT, "dist");
const PUBLIC = path.join(ROOT, "public");
const FETCH_NEW = process.argv.includes("--fetch");
const REFERER = "https://movie.douban.com/";
const UA_IMG = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const CONCURRENCY = 4;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) {
      const idx = i++;
      out[idx] = await fn(list[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

const EXT_BY_TYPE = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

async function downloadCover(item) {
  if (!item.cover || !/^https?:\/\//.test(item.cover)) return "";
  const res = await fetch(item.cover, {
    headers: { "User-Agent": UA_IMG, Referer: REFERER },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[type];
  if (!ext) throw new Error("非图片 " + type);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error("图片太小");
  const name = "covers/" + item.kind + "-" + item.id + "." + ext;
  await fs.mkdir(path.join(DIST, "covers"), { recursive: true });
  await fs.writeFile(path.join(DIST, name), buf);
  return name;
}

async function main() {
  const t0 = Date.now();
  await loadCache();

  if (FETCH_NEW) {
    log("联网刷新豆瓣数据…");
    try {
      await refresh("static-build");
    } catch (err) {
      log("刷新失败，继续用旧缓存：", err.message);
    }
  }

  const cache = getCache();
  if (!cache || (!cache.anime.length && !cache.drama.length)) {
    console.error("没有可用缓存，请先联网运行一次：node scripts/build-static.mjs --fetch");
    process.exit(1);
  }

  log("清理 dist/ 并复制前端资源…");
  await fs.rm(DIST, { recursive: true, force: true });
  await copyDir(PUBLIC, DIST);

  const anime = cache.anime.map((x) => ({ ...x }));
  const drama = cache.drama.map((x) => ({ ...x }));
  const all = [...anime, ...drama];

  // 1) 烘焙剧集（B 站正版分集）
  log("解析 B 站剧集（共 " + all.length + " 部，命中缓存会很快）…");
  let playable = 0;
  let done = 0;
  for (const item of all) {
    try {
      const eps = await resolveEpisodes(item);
      if (eps && eps.ok && Array.isArray(eps.episodes) && eps.episodes.length) {
        item.playable = true;
        item.epsTitle = eps.title || "";
        item.epsSeasonUrl = eps.url || "";
        item.eps = eps.episodes.map((e) => ({
          n: e.n,
          id: e.id,
          aid: e.aid,
          cid: e.cid,
          bvid: e.bvid || "",
          title: e.title,
          longTitle: e.longTitle || "",
          duration: e.duration || 0,
          link: e.link || "",
        }));
        playable++;
      } else {
        item.playable = false;
        item.eps = [];
      }
    } catch (err) {
      item.playable = false;
      item.eps = [];
      log("剧集解析失败", item.title, err.message);
    }
    if (++done % 20 === 0) log("  剧集 " + done + "/" + all.length + "，可播 " + playable);
  }

  // 2) 把豆瓣封面下载到本地（豆瓣图必须带 Referer，否则 418）
  log("下载封面到 dist/covers …");
  let okCover = 0;
  let badCover = 0;
  await mapLimit(all, CONCURRENCY, async (item) => {
    try {
      item.cover = await downloadCover(item);
      okCover++;
    } catch (err) {
      item.cover = "";
      badCover++;
    }
  });
  log("封面成功 " + okCover + "，失败 " + badCover);

  // 3) 数据文件
  const data = {
    version: 3,
    static: true,
    updatedAt: cache.updatedAt || null,
    generatedAt: new Date().toISOString(),
    refreshHours: 6,
    stats: cache.stats || null,
    sources: cache.sources || ["豆瓣"],
    warnings: cache.warnings || [],
    lastError: cache.lastError || "",
    anime,
    drama,
  };
  await fs.writeFile(path.join(DIST, "data.json"), JSON.stringify(data));

  // 4) 给 index.html 打上静态模式标记
  const idxPath = path.join(DIST, "index.html");
  let html = await fs.readFile(idxPath, "utf8");
  html = html.replace(
    '<script type="module" src="./app.js"></script>',
    '<script>window.__STATIC__ = true;</script>\n    <script type="module" src="./app.js"></script>',
  );
  html = html.replace(/<link rel="manifest" href="\/manifest.webmanifest" \/>/, '<link rel="manifest" href="/manifest.webmanifest" />');
  await fs.writeFile(idxPath, html);

  const size = (await fs.stat(path.join(DIST, "data.json"))).size;
  log("完成：" + all.length + " 部（可播 " + playable + "），data.json " + Math.round(size / 1024) + "KB，耗时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
  log("产物目录：" + DIST);
}

main().catch((err) => {
  console.error("构建失败：", err);
  process.exit(1);
});
