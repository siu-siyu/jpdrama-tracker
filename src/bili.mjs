// B 站番剧/影视：按剧名搜索 → 取季 → 取分集，用于「点开就能看」
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./util.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const CACHE_FILE = path.join(ROOT, "data", "episodes.json");
const TTL_OK = 3 * 86400000;       // 查到的结果缓存 3 天
const TTL_MISS = 12 * 3600000;     // 没查到 12 小时后再试
const MIN_GAP = 600;               // 两次 B 站请求之间的间隔，避免被风控

let chain = Promise.resolve();
let lastAt = 0;

function throttle(fn) {
  const run = chain.then(async () => {
    const wait = lastAt + MIN_GAP - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://www.bilibili.com/" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error("bili " + res.status);
  return res.json();
}

const clean = (s) => String(s || "").replace(/<[^>]+>/g, "").trim();
const norm = (s) =>
  clean(s)
    .replace(/[\s:：!?！？·・,，.。'"“”‘’~～\-—()（）\[\]【】]/g, "")
    .toLowerCase();

/** 去掉「第二季 / 第2期 / 中配版」这类后缀，用于宽松匹配 */
function baseTitle(s) {
  return norm(s)
    .replace(/第[一二三四五六七八九十0-9]+[季期部篇]/g, "")
    .replace(/(中配版|粤配版|国语版|日语版|普通话版)/g, "");
}

async function loadCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

let memCache = null;
async function saveCache(obj) {
  memCache = obj;
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  const tmp = CACHE_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(obj));
  await fs.rename(tmp, CACHE_FILE);
}

async function searchSeasons(keyword) {
  const url = "https://api.bilibili.com/x/web-interface/search/all/v2?keyword=" + encodeURIComponent(keyword);
  const body = await throttle(() => getJson(url));
  const list = body?.data?.result ?? [];
  const out = [];
  for (const type of ["media_bangumi", "media_ft"]) {
    const block = list.find((x) => x.result_type === type);
    for (const m of block?.data ?? []) {
      out.push({
        seasonId: m.season_id,
        mediaId: m.media_id,
        title: clean(m.title),
        type: m.season_type_name || (type === "media_bangumi" ? "番剧" : "影视"),
        cover: m.cover ? "https:" + String(m.cover).replace(/^http:/, "") : "",
        eps: m.eps_count || m.eps?.length || 0,
        url: m.url,
      });
    }
  }
  return out;
}

function pickSeason(cands, item) {
  if (!cands.length) return null;
  const want = norm(item.title);
  const wantBase = baseTitle(item.title);
  const prefer = item.kind === "anime" ? "番剧" : "电视剧";
  let best = null;
  let bestScore = -1e9;
  for (const c of cands) {
    const t = norm(c.title);
    const tb = baseTitle(c.title);
    let score = 0;
    if (t === want) score += 120;
    else if (tb === wantBase) score += 90;
    else if (want.length >= 4 && t.includes(want)) score += 55;
    else if (wantBase.length >= 4 && tb.includes(wantBase)) score += 40;
    else continue;
    if (c.type === prefer) score += 25;
    if (/(中配版|粤配版|国语版)/.test(c.title) && !/(中配|粤配|国语)/.test(item.title)) score -= 35;
    if (c.eps) score += Math.min(c.eps, 40) / 10;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best && bestScore > 0 ? best : null;
}

function mapEpisodes(season) {
  const eps = (season?.episodes ?? []).map((e, i) => ({
    n: i + 1,
    id: e.id,
    aid: e.aid,
    cid: e.cid,
    bvid: e.bvid || "",
    title: clean(e.title) || "第" + (i + 1) + "话",
    longTitle: clean(e.long_title),
    cover: e.cover || "",
    duration: e.duration || 0,
    link: e.link || (e.bvid ? "https://www.bilibili.com/video/" + e.bvid : "https://www.bilibili.com/bangumi/play/ep" + e.id),
  }));
  return eps;
}

async function fetchSeason(seasonId) {
  const body = await throttle(() =>
    getJson("https://api.bilibili.com/pgc/view/web/season?season_id=" + encodeURIComponent(seasonId))
  );
  if (body?.code !== 0 || !body?.result) return null;
  const r = body.result;
  return {
    seasonId: r.season_id,
    title: clean(r.title),
    cover: r.cover || "",
    total: r.total ?? (r.episodes ?? []).length,
    url: "https://www.bilibili.com/bangumi/play/ss" + r.season_id,
    episodes: mapEpisodes(r),
  };
}

/** 对一部剧解析出可播放分集；带磁盘缓存（含失败缓存） */
export async function resolveEpisodes(item) {
  if (!memCache) memCache = await loadCache();
  const key = item.kind + ":" + item.id;
  const hit = memCache[key];
  const ttl = hit?.data ? TTL_OK : TTL_MISS;
  if (hit && Date.now() - hit.at < ttl) return hit.data;

  const titles = [item.title, item.originalTitle, item.aka]
    .filter(Boolean)
    .map((s) => String(s).split("/")[0].trim())
    .filter(Boolean);

  let result = null;
  for (const kw of titles) {
    try {
      const cands = await searchSeasons(kw);
      const picked = pickSeason(cands, item);
      if (!picked) continue;
      const season = await fetchSeason(picked.seasonId);
      if (!season || !season.episodes.length) continue;
      result = { ok: true, keyword: kw, ...season };
      break;
    } catch (err) {
      log("B 站解析失败", item.title, err.message);
    }
  }

  const data = result ?? { ok: false, reason: "bilibili" };
  memCache[key] = { at: Date.now(), data };
  try {
    await saveCache(memCache);
  } catch (err) {
    log("分集缓存写入失败", err.message);
  }
  return data;
}
