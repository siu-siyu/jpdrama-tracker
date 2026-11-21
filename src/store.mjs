// 本地缓存 + 定时刷新
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./util.mjs";
import { TAGS, createDetailCache, fetchDetail, fetchList, mapLimit, normalize } from "./douban.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.dirname(HERE);
const DATA_DIR = path.join(ROOT, "data");
const CACHE_FILE = path.join(DATA_DIR, "cache.json");
const DETAIL_FILE = path.join(DATA_DIR, "details.json");

export const REFRESH_HOURS = Math.max(0.25, Number(process.env.REFRESH_HOURS || 6));

let cache = null;
let inflight = null;

export const getCache = () => cache;
export const isRefreshing = () => Boolean(inflight);

export async function loadCache() {
  try {
    cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
  } catch {
    cache = null;
  }
  return cache;
}

async function saveCache(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = CACHE_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, CACHE_FILE);
}

async function loadTag(tag, kind, details, warnings) {
  const list = await fetchList(tag, 2);
  let fetched = 0;
  const items = await mapLimit(list, 5, async (it) => {
    const id = String(it.id || "");
    let detail = details.get(id);
    if (!detail) {
      detail = await fetchDetail(id);
      if (detail) {
        details.set(id, detail);
        fetched++;
      }
    }
    return normalize(kind, it, detail);
  });
  if (fetched) log(tag + "：补全 " + fetched + " 条详情");
  return items.filter((x) => x.id && x.title);
}

async function runRefresh(reason) {
  const t0 = Date.now();
  const warnings = [];
  const details = createDetailCache(DETAIL_FILE);
  await details.load();

  const results = await Promise.allSettled(
    TAGS.map((t) => loadTag(t.tag, t.kind, details, warnings))
  );

  const byKind = {};
  results.forEach((r, i) => {
    const kind = TAGS[i].kind;
    if (r.status === "fulfilled") {
      byKind[kind] = r.value;
    } else {
      warnings.push(TAGS[i].label + "获取失败：" + r.reason.message);
    }
  });

  if (!Object.keys(byKind).length && cache) {
    cache.warnings = warnings;
    cache.lastError = warnings.join(" / ");
    await saveCache(cache);
    log("刷新全部失败，保留旧缓存");
    return cache;
  }

  const sortItems = (list = []) =>
    list
      .slice()
      .sort((a, b) => (b.pubdate || "").localeCompare(a.pubdate || "") || b.rating - a.rating);

  const anime = byKind.anime ?? cache?.anime ?? [];
  const drama = byKind.drama ?? cache?.drama ?? [];
  const weekAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  cache = {
    version: 2,
    updatedAt: new Date().toISOString(),
    anime: sortItems(anime),
    drama: sortItems(drama),
    fresh: {
      anime: anime.filter((x) => x.pubdate >= weekAgo).length,
      drama: drama.filter((x) => x.pubdate >= weekAgo).length,
    },
    stats: {
      anime: anime.length,
      drama: drama.length,
      rated: anime.concat(drama).filter((x) => x.rating > 0).length,
      detailCache: details.size,
    },
    warnings,
    lastError: warnings.join(" / "),
    sources: ["豆瓣"],
    refreshMs: Date.now() - t0,
  };

  await details.save();
  await saveCache(cache);
  log(
    "刷新完成(" + reason + ")",
    "日漫 " + cache.stats.anime,
    "日剧 " + cache.stats.drama,
    ((Date.now() - t0) / 1000).toFixed(1) + "s"
  );
  return cache;
}

export function refresh(reason = "manual") {
  if (inflight) return inflight;
  inflight = runRefresh(reason)
    .catch((err) => {
      log("刷新异常", err.message);
      if (cache) cache.lastError = err.message;
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function isStale() {
  if (!cache?.updatedAt) return true;
  return Date.now() - Date.parse(cache.updatedAt) > REFRESH_HOURS * 3600 * 1000;
}
