// 前端：中文追番列表 + 详情弹层 + 本地追番收藏
const FOLLOW_KEY = "jp-tracker.follows.v2";
const REFRESH_MS = 10 * 60 * 1000;
// 静态部署（Cloudflare Pages 等）时由构建脚本注入 window.__STATIC__ = true
const STATIC = Boolean(window.__STATIC__);

const state = {
  data: null,
  tab: "anime",
  filter: "all",
  playable: new Set(),
  q: "",
  sort: "date",
  follows: new Set(JSON.parse(localStorage.getItem(FOLLOW_KEY) || "[]")),
};

const el = {
  grid: document.getElementById("grid"),
  empty: document.getElementById("empty"),
  statusText: document.getElementById("statusText"),
  statusDot: document.getElementById("statusDot"),
  refreshBtn: document.getElementById("refreshBtn"),
  search: document.getElementById("search"),
  sort: document.getElementById("sort"),
  chips: document.getElementById("chips"),
  sheet: document.getElementById("sheet"),
  sheetBody: document.getElementById("sheetBody"),
  hours: document.getElementById("hours"),
  lanHint: document.getElementById("lanHint"),
  player: document.getElementById("player"),
  playerFrame: document.getElementById("playerFrame"),
  playerTitle: document.getElementById("playerTitle"),
  playerOpen: document.getElementById("playerOpen"),
  playerClose: document.getElementById("playerClose"),
  todayBox: document.getElementById("todayBox"),
  todayRow: document.getElementById("todayRow"),
  todayCount: document.getElementById("todayCount"),
};

if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
  document.documentElement.dataset.theme = "light";
}

const keyOf = (item) => (item.kind === "anime" ? "a:" : "d:") + item.id;

// 豆瓣图片必须走服务端代理（带 Referer），否则返回 418
const coverSrc = (item) => {
  if (!item.cover) return "";
  return STATIC ? item.cover : "/img?u=" + encodeURIComponent(item.cover);
};

function saveFollows() {
  localStorage.setItem(FOLLOW_KEY, JSON.stringify([...state.follows]));
}

function allItems() {
  const d = state.data;
  if (!d) return [];
  if (state.tab === "follow") return [...d.anime, ...d.drama].filter((x) => state.follows.has(keyOf(x)));
  return state.tab === "anime" ? d.anime : d.drama;
}

function isFresh(item) {
  if (item.isNew) return true;
  if (!item.pubdate) return false;
  return Date.parse(item.pubdate) > Date.now() - 30 * 86400000;
}

function visibleItems() {
  const q = state.q.trim().toLowerCase();
  let list = allItems();

  if (state.filter === "fresh") list = list.filter(isFresh);
  if (state.filter === "good") list = list.filter((x) => x.rating >= 8);
  if (state.filter === "playable") list = list.filter((x) => state.playable.has(keyOf(x)));

  if (q) {
    list = list.filter((x) =>
      [x.title, x.originalTitle, x.aka, ...(x.actors || []), ...(x.directors || [])]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }

  const sorted = list.slice();
  if (state.sort === "rating") sorted.sort((a, b) => b.rating - a.rating);
  else if (state.sort === "votes") sorted.sort((a, b) => b.votes - a.votes);
  else sorted.sort((a, b) => (b.pubdate || "").localeCompare(a.pubdate || ""));
  return sorted;
}

function metaLine(item) {
  const parts = [];
  if (item.year) parts.push(item.year);
  if (item.episodes) {
    const p = airProgress(item);
    parts.push(p && p.aired < p.total ? "已播 " + p.aired + "/" + p.total : item.episodes + " 集");
  }
  if (item.genres?.length) parts.push(item.genres.slice(0, 2).join(" / "));
  else if (item.countries?.length) parts.push(item.countries[0]);
  return parts.join(" · ");
}

function makeCard(item) {
  const card = document.createElement("article");
  card.className = "card";
  card.tabIndex = 0;
  card.dataset.id = item.id;

  const cover = document.createElement("div");
  cover.className = "cover";

  const fallback = document.createElement("div");
  fallback.className = "fallback";
  fallback.textContent = (item.title || "?").slice(0, 1);
  cover.appendChild(fallback);

  if (item.cover) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.alt = item.title;
    img.src = coverSrc(item);
    img.addEventListener("load", () => img.classList.add("loaded"));
    img.addEventListener("error", () => img.remove());
    cover.appendChild(img);
  }

  if (item.rating > 0) {
    const badge = document.createElement("span");
    badge.className = "badge" + (item.rating >= 8 ? " good" : "");
    badge.textContent = item.rating.toFixed(1);
    cover.appendChild(badge);
  }

  const star = document.createElement("button");
  star.className = "star" + (state.follows.has(keyOf(item)) ? " on" : "");
  star.textContent = "★";
  star.title = "加入追番";
  star.addEventListener("click", (e) => {
    e.stopPropagation();
    const k = keyOf(item);
    if (state.follows.has(k)) state.follows.delete(k);
    else state.follows.add(k);
    saveFollows();
    star.classList.toggle("on", state.follows.has(k));
    if (state.tab === "follow") render();
  });
  cover.appendChild(star);

  // 有 B 站正版源的，角标提示「点开就能看」
  if (state.playable.has(keyOf(item))) {
    const play = document.createElement("span");
    play.className = "play-tag";
    play.textContent = "▶ 可看";
    play.title = "B 站有正版源，点开就能看";
    cover.appendChild(play);
  }

  const body = document.createElement("div");
  body.className = "body";
  const title = document.createElement("p");
  title.className = "title";
  title.textContent = item.title;
  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = metaLine(item) || item.originalTitle || "";
  body.append(title, meta);

  card.append(cover, body);
  card.addEventListener("click", () => openSheet(item));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openSheet(item);
    }
  });
  return card;
}

// 今天要更新的剧集：按开播日 + 每周一集推算，取落点在今天的
function todayUpdates() {
  const d = state.data;
  if (!d) return [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  const t1 = t0 + 86400000;
  const out = [];
  for (const item of [...d.anime, ...d.drama]) {
    const p = airProgress(item);
    if (!p || !p.nextAt) continue;
    if (p.nextAt >= t0 && p.nextAt < t1) out.push({ item: item, ep: p.aired + 1, at: p.nextAt });
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

function renderToday() {
  if (!el.todayBox || !el.todayRow) return;
  const list = todayUpdates();
  el.todayBox.hidden = list.length === 0;
  if (!list.length) return;
  if (el.todayCount) el.todayCount.textContent = list.length + " 部";
  const frag = document.createDocumentFragment();
  for (const row of list.slice(0, 30)) {
    const b = document.createElement("button");
    b.className = "today-card";
    const t = document.createElement("span");
    t.className = "today-title";
    t.textContent = row.item.title;
    const s = document.createElement("span");
    s.className = "today-sub";
    s.textContent = "第 " + row.ep + " 集 · " + (row.item.kind === "anime" ? "日漫" : "日剧");
    b.append(t, s);
    b.addEventListener("click", () => openSheet(row.item));
    frag.appendChild(b);
  }
  el.todayRow.replaceChildren(frag);
}

function render() {
  const list = visibleItems();
  const frag = document.createDocumentFragment();
  for (const item of list) frag.appendChild(makeCard(item));
  el.grid.replaceChildren(frag);
  el.empty.hidden = list.length > 0;
  el.empty.textContent =
    state.tab === "follow" && !state.follows.size
      ? "还没有追番：点卡片右上角的 ★ 收藏。"
      : "没有匹配的条目，换个词试试。";
  renderStatus();
  renderToday();
}

function renderStatus() {
  const d = state.data;
  if (!d) return;
  const stats = d.stats || {};
  const upd = d.updatedAt ? new Date(d.updatedAt) : null;
  const hhmm = upd ? upd.toTimeString().slice(0, 5) : "--:--";
  const n = state.tab === "anime" ? stats.anime : state.tab === "drama" ? stats.drama : state.follows.size;
  const unit = state.tab === "follow" ? "部追番" : "部在列";
  el.statusText.textContent = hhmm + " 更新 · " + n + " " + unit + " · 追番 " + state.follows.size;
  el.hours.textContent = d.refreshHours || 6;

  el.statusDot.className = "dot" + (d.lastError && !d.updatedAt ? " is-bad" : "");
}

async function loadData(force) {
  el.refreshBtn.classList.add("spin");
  el.statusDot.className = "dot is-loading";
  try {
    if (STATIC) {
      const res = await fetch("./data.json?t=" + Date.now(), { cache: "no-store" });
      state.data = await res.json();
      for (const it of [...(state.data.anime || []), ...(state.data.drama || [])]) {
        if (it.playable) state.playable.add(keyOf(it));
      }
      el.refreshBtn.hidden = true;
      el.statusDot.className = "dot";
      render();
      return;
    }
    if (force) await fetch("/api/refresh", { method: "POST" });
    const res = await fetch("/api/data", { cache: "no-store" });
    state.data = await res.json();
    el.statusDot.className = "dot" + (state.data.lastError ? " is-bad" : "");
    render();
  } catch (err) {
    el.statusDot.className = "dot is-bad";
    el.statusText.textContent = "连不上服务：" + err.message;
  } finally {
    el.refreshBtn.classList.remove("spin");
  }
}

function detailRow(label, value) {
  if (!value) return null;
  const p = document.createElement("p");
  p.className = "sub";
  p.textContent = label + "：" + value;
  return p;
}

// 豆瓣只给首播日和总集数，按「每周一集」推算已播到第几集、下一集哪天
function airProgress(item) {
  const total = Number(item.episodes) || 0;
  const start = item.pubdate ? Date.parse(item.pubdate) : NaN;
  if (!total || !Number.isFinite(start)) return null;
  const week = 7 * 86400000;
  const aired = Math.min(total, Math.floor((Date.now() - start) / week) + 1);
  if (aired < 1) return null;
  const nextAt = aired >= total ? 0 : start + aired * week;
  return { total, aired, nextAt, weekday: new Date(start).getDay() };
}

const WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const mdCN = (ts) => new Date(ts).getMonth() + 1 + " 月 " + new Date(ts).getDate() + " 日";

// 详情里的「剧集」：按剧名去 B 站找正版季，点一集就在站内播放
function episodesSection(item, autoPlay) {
  const wrap = document.createElement("section");
  wrap.className = "eps";

  const head = document.createElement("div");
  head.className = "eps-head";
  const label = document.createElement("strong");
  label.textContent = "剧集";
  const hint = document.createElement("span");
  hint.className = "eps-hint";
  const prog0 = airProgress(item);
  hint.textContent = prog0
    ? "已播 " + prog0.aired + " / 共 " + prog0.total + " 集" +
      (prog0.nextAt ? " · 第 " + (prog0.aired + 1) + " 集 " + mdCN(prog0.nextAt) + "（" + WEEK_CN[prog0.weekday] + "更新）" : " · 已完结")
    : "按剧名在 B 站找正版源…";
  head.append(label, hint);

  const body = document.createElement("div");
  body.className = "eps-body";
  body.textContent = "加载中…";

  wrap.append(head, body);
  loadEpisodes(item, body, hint, autoPlay);
  return wrap;
}

async function loadEpisodes(item, body, hint, autoPlay) {
  try {
    let data = null;
    if (STATIC) {
      // 静态部署时剧集信息已经烘焙进 data.json
      data = item.eps && item.eps.length ? { ok: true, title: item.epsTitle || "", episodes: item.eps } : null;
    } else {
      const res = await fetch(
        "/api/episodes?kind=" + encodeURIComponent(item.kind) + "&id=" + encodeURIComponent(item.id),
        { cache: "no-store" }
      );
      data = await res.json().catch(() => null);
    }
    if (!data || !data.ok || !(data.episodes || []).length) {
      const fp = airProgress(item);
      hint.textContent = fp
        ? "已播 " + fp.aired + " / 共 " + fp.total + " 集 · 暂无正版源"
        : "没有找到正版在线源";
      const p = document.createElement("p");
      p.className = "eps-empty";
      p.textContent = "这部剧暂未在 B 站上架（国内正版方还没上）。可以先去下面这些平台搜一下，或者先收藏等更新。";
      const links = document.createElement("div");
      links.className = "eps-links";
      const kw = encodeURIComponent(item.title);
      const jpName = (item.aka && item.aka[0]) || item.originalTitle || item.title;
      const jw = encodeURIComponent(jpName);
      const targets = [
        ["B 站", "https://search.bilibili.com/all?keyword=" + kw],
        ["爱奇艺", "https://so.iqiyi.com/so/q_" + kw],
        ["腾讯视频", "https://v.qq.com/x/search/?q=" + kw],
        ["优酷", "https://so.youku.com/search_video/q=" + kw],
        ["TVer（日本免费）", "https://tver.jp/search?q=" + jw],
        ["DMM TV（日本）", "https://tv.dmm.com/search/?q=" + jw],
        ["Netflix 日本", "https://www.netflix.com/search?q=" + jw],
        ["百度搜「在线」", "https://www.baidu.com/s?wd=" + encodeURIComponent(item.title + " 在线观看")],
        ["微博讨论", "https://s.weibo.com/weibo?q=" + encodeURIComponent(item.title)],
      ];
      for (const [label, href] of targets) {
        const a = document.createElement("a");
        a.className = "eps-search";
        a.href = href;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.textContent = label + " 搜「" + (label.indexOf("日本") >= 0 || label.indexOf("TVer") === 0 || label.indexOf("DMM") === 0 ? jpName : item.title) + "」";
        links.appendChild(a);
      }
      const tip = document.createElement("p");
      tip.className = "eps-tip";
      tip.textContent = "日本平台（TVer / DMM / Netflix 日本）需要日本网络环境。本站在国内正版平台没有上架时，只提供搜索入口，不收录、不代理任何片源。";
      body.replaceChildren(p, links, tip);
      return;
    }

    const prog = airProgress(item);
    hint.textContent =
      (prog ? "已播 " + prog.aired + " / 共 " + prog.total + " 集" : "共 " + data.episodes.length + " 集") +
      " · B 站上架 " + data.episodes.length + " 集 · " + (data.title || "正版源");
    const grid = document.createElement("div");
    grid.className = "eps-grid";
    for (const ep of data.episodes) {
      const btn = document.createElement("button");
      btn.className = "ep";
      btn.type = "button";
      const n = document.createElement("span");
      n.className = "ep-n";
      n.textContent = String(ep.n);
      const t = document.createElement("span");
      t.className = "ep-t";
      t.textContent = ep.longTitle || ep.title;
      btn.title = ep.title + (ep.longTitle && ep.longTitle !== ep.title ? " " + ep.longTitle : "");
      btn.append(n, t);
      btn.addEventListener("click", () => openPlayer(ep, item, data.title));
      grid.appendChild(btn);
      if (autoPlay && ep.n === autoPlay) btn.dataset.autoplay = "1";
    }
    // B 站没上架的集数也列出来：已播但缺源 / 还没播
    const progAll = airProgress(item);
    const have = new Set(data.episodes.map((e) => Number(e.n)));
    const total = Math.max(progAll ? progAll.total : 0, data.episodes.length);
    for (let n = 1; n <= total; n++) {
      if (have.has(n)) continue;
      const btn = document.createElement("button");
      const aired = !progAll || n <= progAll.aired;
      btn.className = "ep" + (aired ? " missing" : " soon");
      btn.type = "button";
      const nn = document.createElement("span");
      nn.className = "ep-n";
      nn.textContent = String(n);
      const tt = document.createElement("span");
      tt.className = "ep-t";
      tt.textContent = aired ? "暂无正版源" : "未播出";
      btn.append(nn, tt);
      btn.title = aired
        ? "第 " + n + " 集：B 站还没有正版源，可以先用下方搜索入口"
        : "第 " + n + " 集：" + mdCN(progAll.nextAt + (n - progAll.aired - 1) * 7 * 86400000) + " 播出";
      btn.disabled = !aired;
      grid.appendChild(btn);
    }
    body.replaceChildren(grid);
    const auto = Array.from(grid.children).find((c) => c.dataset && c.dataset.autoplay === "1");
    if (auto) auto.click();
  } catch (err) {
    hint.textContent = "";
    body.textContent = "剧集加载失败：" + err.message;
  }
}

function openPlayer(ep, item, seasonTitle) {
  const src =
    "https://player.bilibili.com/player.html?aid=" + ep.aid +
    (ep.bvid ? "&bvid=" + ep.bvid : "") +
    "&cid=" + ep.cid + "&page=1&high_quality=1&danmaku=0&autoplay=1";
  el.playerFrame.src = src;
  el.playerTitle.textContent = (seasonTitle || item.title) + " · " + (ep.longTitle || ep.title);
  el.playerOpen.href = ep.link || item.biliSearch;
  el.player.hidden = false;
  document.body.style.overflow = "hidden";
}

function closePlayer() {
  el.player.hidden = true;
  el.playerFrame.src = "about:blank";
  if (!el.sheet.hidden) document.body.style.overflow = "hidden";
}

function openSheet(item, autoPlay) {
  const head = document.createElement("div");
  head.className = "detail-head";

  if (item.cover) {
    const img = document.createElement("img");
    img.src = coverSrc(item);
    img.alt = item.title;
    img.referrerPolicy = "no-referrer";
    head.appendChild(img);
  }

  const info = document.createElement("div");
  const h2 = document.createElement("h2");
  h2.textContent = item.title;
  info.appendChild(h2);

  const sub1 = document.createElement("p");
  sub1.className = "sub";
  if (item.rating > 0) {
    const s = document.createElement("span");
    s.className = "score";
    s.textContent = "★ " + item.rating.toFixed(1);
    sub1.appendChild(s);
    if (item.votes) sub1.appendChild(document.createTextNode(" · " + item.votes + " 人评分"));
  } else {
    sub1.textContent = "暂无评分";
  }
  info.appendChild(sub1);

  const line = [
    item.year,
    (item.countries || []).join(" "),
    item.episodes ? "全 " + item.episodes + " 集" : "",
    item.pubdate ? item.pubdate + " 首播" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (line) {
    const p = document.createElement("p");
    p.className = "sub";
    p.textContent = line;
    info.appendChild(p);
  }

  const names = detailRow("原名", item.originalTitle);
  if (names) info.appendChild(names);
  const aka = detailRow("又名", item.aka);
  if (aka) info.appendChild(aka);
  const staff = detailRow(
    "阵容",
    [item.directors?.length ? item.directors.join("/") : "", item.actors?.slice(0, 5).join("、") || ""]
      .filter(Boolean)
      .join(" · ")
  );
  if (staff) info.appendChild(staff);

  head.appendChild(info);

  const tags = document.createElement("div");
  tags.className = "detail-tags";
  for (const g of item.genres || []) {
    const s = document.createElement("span");
    s.textContent = g;
    tags.appendChild(s);
  }

  const intro = document.createElement("p");
  intro.className = "detail-intro";
  intro.textContent = item.intro || "（豆瓣暂无简介）";

  const actions = document.createElement("div");
  actions.className = "detail-actions";

  const follow = document.createElement("button");
  const on = state.follows.has(keyOf(item));
  follow.textContent = on ? "★ 已在追番" : "☆ 加入追番";
  follow.className = on ? "" : "primary";
  follow.addEventListener("click", () => {
    const k = keyOf(item);
    if (state.follows.has(k)) state.follows.delete(k);
    else state.follows.add(k);
    saveFollows();
    const nowOn = state.follows.has(k);
    follow.textContent = nowOn ? "★ 已在追番" : "☆ 加入追番";
    follow.className = nowOn ? "" : "primary";
    render();
  });

  const douban = document.createElement("a");
  douban.href = item.doubanUrl;
  douban.target = "_blank";
  douban.rel = "noreferrer";
  douban.textContent = "豆瓣详情";

  const bili = document.createElement("a");
  bili.href = item.biliSearch;
  bili.target = "_blank";
  bili.rel = "noreferrer";
  bili.textContent = "在 B 站找";

  actions.append(follow, douban, bili);
  el.sheetBody.replaceChildren(head, tags, intro, episodesSection(item, autoPlay), actions);
  el.sheet.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeSheet() {
  el.sheet.hidden = true;
  document.body.style.overflow = "";
}

el.sheet.addEventListener("click", (e) => {
  if (e.target.hasAttribute("data-close")) closeSheet();
});

if (el.playerClose) el.playerClose.addEventListener("click", closePlayer);
if (el.player) {
  el.player.addEventListener("click", (e) => {
    if (e.target === el.player) closePlayer();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!el.player.hidden) return closePlayer();
  if (!el.sheet.hidden) closeSheet();
});

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("is-on", b === btn));
    state.tab = btn.dataset.tab;
    if (state.tab === "follow") {
      state.filter = "all";
      el.chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-on", c.dataset.filter === "all"));
    }
    render();
  });
});

el.chips.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  el.chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-on", c === btn));
  state.filter = btn.dataset.filter;
  render();
});

el.search.addEventListener("input", (e) => {
  state.q = e.target.value;
  render();
});

el.sort.addEventListener("change", (e) => {
  state.sort = e.target.value;
  render();
});

el.refreshBtn.addEventListener("click", () => loadData(true));

loadData(false);
loadPlayable();

// 拉一次「哪些能在站内直接看」的清单（B 站有正版源的）
async function loadPlayable() {
  if (STATIC) return; // 静态部署时清单已随 data.json 下发
  try {
    const res = await fetch("/api/playable", { cache: "no-store" });
    const data = await res.json();
    for (const it of data.items || []) state.playable.add(it.kind === "anime" ? "a:" + it.id : "d:" + it.id);
    if (state.playable.size) render();
  } catch {
    /* 忽略：没有清单也能正常浏览 */
  }
}

// 深链：?kind=drama&id=38230782&ep=1 直接打开某部剧并播放某一集
async function openFromUrl() {
  const q = new URLSearchParams(location.search);
  const id = q.get("id");
  if (!id) return;
  const kind = q.get("kind") === "drama" ? "drama" : "anime";
  for (let i = 0; i < 30 && !state.data; i++) await new Promise((r) => setTimeout(r, 150));
  if (!state.data) return;
  const pool = kind === "drama" ? state.data.drama : state.data.anime;
  const item = (pool || []).find((x) => String(x.id) === String(id));
  if (!item) return;
  state.tab = kind;
  render();
  openSheet(item, Number(q.get("ep")) || 0);
}
openFromUrl();

// 手机切回前台时静默刷新一次数据
setInterval(() => {
  if (!document.hidden) loadData(false);
}, REFRESH_MS);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.data) loadData(false);
});

// 注册 Service Worker，手机上可「添加到主屏幕」像 App 一样用
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// 本机打开时提示手机访问地址（同一 Wi-Fi）
if (!STATIC) fetch("/api/status")
  .then((r) => r.json())
  .then((s) => {
    if (s.refreshHours) el.hours.textContent = s.refreshHours;
    const isLocal = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    if (!isLocal || !s.lan?.length) return;
    el.lanHint.hidden = false;
    el.lanHint.textContent = "手机连同一 Wi-Fi，打开 " + s.lan[0];
  })
  .catch(() => {});

export {};
