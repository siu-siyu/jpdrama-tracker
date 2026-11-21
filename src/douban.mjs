// 豆瓣数据源：中文剧名 / 评分 / 简介 / 首播日期
// 列表接口按标签取「最近更新」，详情接口补全简介、卡司、集数等信息。
import fs from "node:fs/promises";
import path from "node:path";
import { log, sleep, stripHtml } from "./util.mjs";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const LIST_BASE = "https://movie.douban.com/j/search_subjects";
const DETAIL_BASE = "https://m.douban.com/rexxar/api/v2/tv/";

export const TAGS = [
  { kind: "anime", tag: "日本动画", label: "日漫" },
  { kind: "drama", tag: "日剧", label: "日剧" },
];

async function getJSON(url, referer = "https://m.douban.com/tv/", timeoutMs = 15000) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: referer, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

export async function fetchList(tag, pages = 2, pageSize = 40) {
  const out = [];
  for (let page = 0; page < pages; page++) {
    const url =
      LIST_BASE +
      "?type=tv&tag=" +
      encodeURIComponent(tag) +
      "&sort=time&page_limit=" +
      pageSize +
      "&page_start=" +
      page * pageSize;
    const data = await getJSON(url, "https://movie.douban.com/explore");
    const subjects = data?.subjects ?? [];
    out.push(...subjects);
    if (subjects.length < pageSize) break;
    await sleep(120);
  }
  return out;
}

export async function fetchDetail(id) {
  for (let i = 0; i < 2; i++) {
    try {
      return await getJSON(DETAIL_BASE + id);
    } catch (err) {
      if (i === 1) return null;
      await sleep(400);
    }
  }
  return null;
}

function pickDate(pubdate) {
  const raw = Array.isArray(pubdate) ? pubdate[0] : pubdate;
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(raw || ""));
  return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// 把「列表项 + 详情」归一化成前端直接可用的结构
export function normalize(kind, listItem, detail) {
  const d = detail || {};
  const rating = toNum(d?.rating?.value || listItem?.rate);
  const intro = stripHtml(d.intro || "", 300);
  const directors = (d.directors || []).map((x) => x.name).filter(Boolean).slice(0, 2);
  const actors = (d.actors || []).map((x) => x.name).filter(Boolean).slice(0, 6);
  const title = d.title || listItem.title || "";
  return {
    id: String(listItem.id || d.id || ""),
    kind,
    title,
    originalTitle: d.original_title || "",
    aka: (d.aka || []).slice(0, 2).join(" / "),
    year: String(d.year || "").slice(0, 4),
    rating,
    votes: toNum(d?.rating?.count),
    episodes: toNum(d.episodes_count),
    pubdate: pickDate(d.pubdate),
    countries: d.countries || [],
    genres: (d.genres || []).slice(0, 4),
    directors,
    actors,
    intro,
    cover: d.cover_url || d.pic || listItem.cover || "",
    doubanUrl: listItem.url || "https://movie.douban.com/subject/" + (listItem.id || "") + "/",
    biliSearch: "https://search.bilibili.com/all?keyword=" + encodeURIComponent(title),
    isNew: Boolean(listItem.is_new),
    card_subtitle: d.card_subtitle || "",
  };
}

// 详情缓存：同一部剧 7 天内不重复抓，节省请求也更快
export function createDetailCache(file) {
  let map = {};
  let dirty = false;

  return {
    async load() {
      try {
        map = JSON.parse(await fs.readFile(file, "utf8"));
      } catch {
        map = {};
      }
      return map;
    },
    get(id) {
      const hit = map[id];
      if (!hit) return null;
      if (Date.now() - hit.at > 7 * 86400000) return null;
      return hit.d;
    },
    set(id, detail) {
      map[id] = { at: Date.now(), d: detail };
      dirty = true;
    },
    async save() {
      if (!dirty) return;
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = file + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(map), "utf8");
      await fs.rename(tmp, file);
      dirty = false;
    },
    get size() {
      return Object.keys(map).length;
    },
  };
}

// 按并发上限批量取详情
export async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

export { log };
