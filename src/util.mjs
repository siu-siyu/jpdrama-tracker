// 通用小工具
export const DAY_MS = 86400000;
export const SEASON_CN = { WINTER: "冬", SPRING: "春", SUMMER: "夏", FALL: "秋" };
export const UA = "jpdrama-tracker/1.0 (local app)";

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchJSON(url, opts = {}, timeoutMs = 25000) {
  const res = await fetch(url, {
    ...opts,
    headers: { "User-Agent": UA, Accept: "application/json", ...(opts.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
  return res.json();
}

function jstParts(date = new Date()) {
  const j = new Date(date.getTime() + 9 * 3600 * 1000);
  return { y: j.getUTCFullYear(), m: j.getUTCMonth() + 1, d: j.getUTCDate() };
}

export function currentSeason(date = new Date()) {
  const { y, m } = jstParts(date);
  const season = m <= 3 ? "WINTER" : m <= 6 ? "SPRING" : m <= 9 ? "SUMMER" : "FALL";
  return { season, year: y, label: y + " " + SEASON_CN[season] + "季" };
}

export function jstDateStr(offsetDays = 0) {
  const j = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * DAY_MS);
  return j.toISOString().slice(0, 10);
}

export function stripHtml(input, max = 260) {
  if (!input) return "";
  let s = String(input)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) s = s.slice(0, max).trim() + "…";
  return s;
}

export function rfc822(ts) {
  return new Date(ts).toUTCString().replace("GMT", "+0000");
}
