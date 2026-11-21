// 用最小 DOM 桩跑一遍前端渲染逻辑，确认卡片/搜索/详情弹层都正常
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const STATIC = process.argv.includes("--static");
const DATA_FILE = STATIC ? path.join(ROOT, "dist", "data.json") : path.join(ROOT, "data", "cache.json");
const cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : force;
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }
  get value() { return [...this.set].join(" "); }
}

class El {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.class_ = "";
    this.classList = new ClassList(this);
    this.listeners = {};
    this.textContent = "";
    this.hidden = false;
    this.parent = null;
  }
  get className() { return this.class_; }
  set className(v) { this.class_ = v; this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  appendChild(node) {
    if (node.tagName === "FRAGMENT") { node.children.slice().forEach((c) => this.appendChild(c)); return node; }
    node.parent = this;
    this.children.push(node);
    return node;
  }
  append(...nodes) { nodes.forEach((n) => this.appendChild(n)); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  click() { this.dispatch("click"); }
  dispatch(type, extra = {}) {
    const ev = { type, target: this, stopPropagation() {}, preventDefault() {}, ...extra };
    for (const fn of this.listeners[type] || []) fn(ev);
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }
  closest(sel) {
    let node = this;
    const want = sel.replace(".", "");
    while (node) {
      if (node.classList.contains(want)) return node;
      node = node.parent;
    }
    return null;
  }
  querySelectorAll(sel) {
    const want = sel.replace(".", "");
    const out = [];
    const walk = (n) => n.children.forEach((c) => { if (c.classList.contains(want)) out.push(c); walk(c); });
    walk(this);
    return out;
  }
  get innerHTML() { return ""; }
}

const ids = ["grid", "empty", "statusText", "statusDot", "refreshBtn", "search", "sort", "chips", "sheet", "sheetBody", "hours", "lanHint", "player", "playerFrame", "playerTitle", "playerOpen", "playerClose"];
const store = new Map(ids.map((id) => [id, new El()]));
store.get("sheet").hidden = true;

const tabs = ["anime", "drama", "follow"].map((t) => {
  const b = new El("button");
  b.className = "tab";
  b.dataset.tab = t;
  return b;
});
const chips = ["all", "fresh", "good", "playable", "follow"].map((f) => {
  const b = new El("button");
  b.className = "chip" + (f === "all" ? " is-on" : "");
  b.dataset.filter = f;
  return b;
});
store.get("chips").append(...chips);

const document = {
  getElementById: (id) => store.get(id) ?? null,
  createElement: (tag) => new El(tag),
  createDocumentFragment: () => new El("fragment"),
  createTextNode: (t) => ({ tagName: "#text", nodeType: 3, children: [], textContent: String(t) }),
  querySelectorAll: (sel) => (sel === ".tab" ? tabs : sel === ".chip" ? chips : []),
  addEventListener: () => {},
  body: { style: {} },
  documentElement: { dataset: {} },
  hidden: false,
};

const localStorage = {
  map: new Map(),
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; },
  setItem(k, v) { this.map.set(k, String(v)); },
};

const responses = {
  "/api/data": cache,
  "./data.json": cache,
  "/api/status": { lan: ["http://192.168.0.104:7788"], refreshHours: 6 },
  "/api/playable": { count: 1, items: [{ kind: "drama", id: "38230782", title: "绑架游戏", eps: 4 }] },
};

globalThis.document = document;
globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener: () => {} };
if (STATIC) globalThis.window.__STATIC__ = true;
globalThis.localStorage = localStorage;
globalThis.location = { hostname: "127.0.0.1", href: "http://127.0.0.1:7788/" };
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "node" }, configurable: true });
globalThis.fetch = async (url) => {
  const key = String(url).split("?")[0];
  if (responses[key]) return { ok: true, json: async () => responses[key] };
  return { ok: true, json: async () => ({}) };
};

const fails = [];
const check = (name, ok, detail = "") => {
  if (!ok) fails.push(name + (detail ? " → " + detail : ""));
  console.log((ok ? "  ✓ " : "  ✗ ") + name + (ok ? "" : " " + detail));
};

await import(pathToFileURL(path.join(ROOT, "public", "app.js")).href);
await new Promise((r) => setTimeout(r, 120));

const grid = store.get("grid");
check("日漫标签渲染卡片", grid.children.length === cache.anime.length, grid.children.length + " vs " + cache.anime.length);

const firstTitle = grid.children[0]?.children[1]?.children[0]?.textContent;
check("卡片标题取最新开播", Boolean(firstTitle), String(firstTitle));

const search = store.get("search");
search.dispatch("input", { target: { value: cache.anime[0].title.slice(0, 2) } });
check("搜索过滤生效", grid.children.length >= 1 && grid.children.length < cache.anime.length, String(grid.children.length));
search.dispatch("input", { target: { value: "" } });

const dramaTab = tabs.find((t) => t.dataset.tab === "drama");
dramaTab.dispatch("click");
check("切到日剧标签", grid.children.length === cache.drama.length, grid.children.length + " vs " + cache.drama.length);

grid.children[0].dispatch("click");
const sheet = store.get("sheet");
check("点卡片弹出详情", sheet.hidden === false);
const sheetKids = store.get("sheetBody").children;
check("详情含简介、剧集与按钮", sheetKids.length === 5, String(sheetKids.length));
await new Promise((r) => setTimeout(r, 30));
const epsBody = sheetKids[3];
const epsHead = epsBody?.children?.[0];
check("剧集区显示已播进度", /已播 \d+ \/ 共 \d+ 集/.test(epsHead?.children?.[1]?.textContent || ""), String(epsHead?.children?.[1]?.textContent || ""));
const epsInner = epsBody?.children?.[1]?.children?.[0];
check("剧集区有兜底提示", /B 站上架/.test(epsInner?.textContent || ""), String(epsInner?.textContent || ""));

const star = grid.children[0].children[0].children.at(-1);
star.dispatch("click");
check("收藏写入 localStorage", (localStorage.getItem("jp-tracker.follows.v2") || "").includes(cache.drama[0].id));

const followTab = tabs.find((t) => t.dataset.tab === "follow");
followTab.dispatch("click");
check("追番标签只显示收藏", grid.children.length === 1, String(grid.children.length));

// —— 「▶ 能直接看」筛选（在单实例下测） ——
const playChip = chips.find((c) => c.dataset.filter === "playable");
dramaTab.dispatch("click");
store.get("chips").dispatch("click", { target: playChip }); // 真实浏览器里事件从 chip 冒泡到 nav
const playCount = store.get("grid").children.length;
check("「能直接看」筛选只留可播条目", playCount === 1, String(playCount));
check("可播卡片有 ▶ 角标", /可看/.test(store.get("grid").children[0]?.children?.[0]?.children?.map((c) => c.textContent).join(" ") || ""));
if (STATIC) {
  store.get("grid").children[0].dispatch("click");
  await new Promise((r) => setTimeout(r, 60));
  const pb = store.get("sheetBody").children[3];
  const epBtns = pb?.querySelectorAll(".ep") || [];
  check("静态模式可播剧集直接出现分集按钮", epBtns.length >= 1, String(epBtns.length));
  epBtns[0]?.dispatch("click");
  check("静态模式点分集可起播", /player\.bilibili\.com\/player\.html/.test(String(store.get("playerFrame").src || "")), String(store.get("playerFrame").src || "").slice(0, 50));
  store.get("player").hidden = true;
}

// —— 深链：?kind=drama&id=xxx&ep=1 应直接打开详情并起播 ——
const demoDrama = cache.drama.find((d) => d.id === "38230782") || cache.drama[0];
const biliEp = { n: 1, id: 835996, aid: 113111688283883, cid: 25809259408, bvid: "BV1pbpxebEdb", title: "1", longTitle: "", link: "https://www.bilibili.com/bangumi/play/ep835996" };
responses["/api/episodes"] = { ok: true, title: "绑架游戏", episodes: [biliEp, { ...biliEp, n: 2, id: 835995, cid: 25809259353, bvid: "BV1CbpxebE2C", link: "https://www.bilibili.com/bangumi/play/ep835995" }] };
const deepQuery = "?kind=drama&id=" + demoDrama.id + "&ep=1";
globalThis.location = { hostname: "127.0.0.1", href: "http://127.0.0.1:7788/" + deepQuery, search: deepQuery };
store.get("sheet").hidden = true;
store.get("player").hidden = true;
store.get("playerFrame").src = "";
await import(pathToFileURL(path.join(ROOT, "public", "app.js")).href + "?deep=1");
await new Promise((r) => setTimeout(r, 900));
check("深链自动打开剧集详情", store.get("sheet").hidden === false);
const srcRe = STATIC ? /player\.bilibili\.com\/player\.html\?aid=\d+/ : /player\.bilibili\.com\/player\.html\?aid=113111688283883/;
check("深链自动起播第 1 集", srcRe.test(String(store.get("playerFrame").src || "")), String(store.get("playerFrame").src || "").slice(0, 70));
check("播放器标题含剧名集号", /绑架游戏|·/.test(String(store.get("playerTitle").textContent || "")));

console.log(fails.length ? "\n失败 " + fails.length + " 项" : "\n全部通过");
process.exit(fails.length ? 1 : 0);
