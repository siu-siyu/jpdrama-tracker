#!/usr/bin/env node
// 用 GitHub API 直接建仓库、上传全部源码、开启 Pages、触发首次构建。
// 之所以不用 git push：本机 DNS 把 github.com 解析到无法连接的 IP，git 的传输层用不了。
// 依赖 data/.gh-token（由 scripts/gh-auth.mjs 设备流写入）。
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_NAME = process.env.REPO_NAME || "jpdrama-tracker";
const API = "https://api.github.com";
const SKIP_DIRS = new Set([".git", "data", "dist", ".tools", "node_modules", ".venv", ".chrome", ".edge-profile"]);
const SKIP_EXT = new Set([".idsig", ".log"]);

const token = (await fs.readFile(path.join(ROOT, "data", ".gh-token"), "utf8")).trim();
async function api(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "jpdrama-deploy",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, data, text };
}

async function walk(dir, base = ROOT) {
  const out = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || rel.startsWith("dist")) {
        // B 站分集缓存要进仓库：runner 访问 B 站会被风控 412，只能沿用本机解析结果
        if (rel === "data") out.push({ full: path.join(full, "episodes.json"), rel: "data/episodes.json" });
        continue;
      }
      out.push(...(await walk(full, base)));
    } else {
      if (SKIP_EXT.has(path.extname(ent.name))) continue;
      const stat = await fs.stat(full);
      if (stat.size > 5 * 1024 * 1024) continue;
      out.push({ full, rel });
    }
  }
  return out;
}

const me = await api("GET", "/user");
if (!me.data?.login) { console.log("token 无效：" + me.status); process.exit(1); }
const owner = me.data.login;
console.log("账号：" + owner);

let repo = await api("GET", `/repos/${owner}/${REPO_NAME}`);
if (repo.status === 404) {
  const created = await api("POST", "/user/repos", {
    name: REPO_NAME,
    description: "日漫日剧中文情报站（豆瓣数据源 + B 站分集 + 每 6 小时自动更新）",
    private: false,
    has_issues: false,
    has_wiki: false,
  });
  if (created.status >= 300) { console.log("建仓库失败：" + created.status + " " + created.text.slice(0, 200)); process.exit(1); }
  repo = created;
  console.log("已创建仓库 https://github.com/" + owner + "/" + REPO_NAME);
} else {
  console.log("仓库已存在，覆盖更新");
}

// 空仓库不能直接建 blob（会 409），先用 Contents API 落一个初始提交
const empty = await api("GET", `/repos/${owner}/${REPO_NAME}/git/ref/heads/main`);
if (empty.status !== 200) {
  const init = await api("PUT", `/repos/${owner}/${REPO_NAME}/contents/README.md`, {
    message: "chore: 初始化仓库",
    content: Buffer.from("# jpdrama-tracker\n").toString("base64"),
  });
  if (init.status >= 300) { console.log("初始化失败：" + init.status + " " + init.text.slice(0, 200)); process.exit(1); }
  console.log("已创建初始提交");
}

const files = await walk(ROOT);
console.log("待上传文件 " + files.length + " 个");

const blobs = [];
let i = 0;
async function worker() {
  while (i < files.length) {
    const f = files[i++];
    const content = await fs.readFile(f.full);
    const r = await api("POST", `/repos/${owner}/${REPO_NAME}/git/blobs`, {
      content: content.toString("base64"),
      encoding: "base64",
    });
    if (r.status >= 300) throw new Error("上传失败 " + f.rel + " " + r.status);
    blobs.push({ path: f.rel, mode: "100644", type: "blob", sha: r.data.sha });
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);

const tree = await api("POST", `/repos/${owner}/${REPO_NAME}/git/trees`, { tree: blobs });
if (tree.status >= 300) { console.log("建 tree 失败：" + tree.text.slice(0, 300)); process.exit(1); }

const refRes = await api("GET", `/repos/${owner}/${REPO_NAME}/git/ref/heads/main`);
const parents = refRes.status === 200 ? [refRes.data.object.sha] : [];
const commit = await api("POST", `/repos/${owner}/${REPO_NAME}/git/commits`, {
  message: "feat: 日漫日剧情报站（豆瓣数据源 + B 站分集 + 静态导出 + Pages 自动更新）",
  tree: tree.data.sha,
  parents,
});
if (commit.status >= 300) { console.log("建 commit 失败：" + commit.text.slice(0, 300)); process.exit(1); }

const ref = refRes.status === 200
  ? await api("PATCH", `/repos/${owner}/${REPO_NAME}/git/refs/heads/main`, { sha: commit.data.sha })
  : await api("POST", `/repos/${owner}/${REPO_NAME}/git/refs`, { ref: "refs/heads/main", sha: commit.data.sha });
if (ref.status >= 300) { console.log("更新分支失败：" + ref.text.slice(0, 300)); process.exit(1); }
console.log("源码已推送：" + commit.data.sha.slice(0, 7));

// 用「GitHub Actions」作为 Pages 源
const pages = await api("POST", `/repos/${owner}/${REPO_NAME}/pages`, { build_type: "workflow" });
if (pages.status >= 300 && pages.status !== 409) {
  const patch = await api("PUT", `/repos/${owner}/${REPO_NAME}/pages`, { build_type: "workflow" });
  if (patch.status >= 300) console.log("启用 Pages 返回 " + pages.status + " / " + patch.status + "（可稍后在网页手动点）");
  else console.log("Pages 已启用（workflow 模式）");
} else {
  console.log("Pages 已启用（workflow 模式）");
}

const site = `https://${owner.toLowerCase()}.github.io/${REPO_NAME}/`;
const dispatch = await api("POST", `/repos/${owner}/${REPO_NAME}/actions/workflows/update.yml/dispatches`, { ref: "main" });
console.log("触发首次构建：" + (dispatch.status < 300 ? "已排队" : dispatch.status + " " + dispatch.text.slice(0, 120)));
console.log("站点地址（构建完成后生效）：" + site);

for (let t = 0; t < 60; t++) {
  await new Promise((r) => setTimeout(r, 10000));
  const runs = await api("GET", `/repos/${owner}/${REPO_NAME}/actions/runs?per_page=1`);
  const run = runs.data?.workflow_runs?.[0];
  if (!run) continue;
  console.log("构建状态：" + run.status + (run.conclusion ? " / " + run.conclusion : ""));
  if (run.status === "completed") {
    console.log("结论：" + run.conclusion + "  详情：" + run.html_url);
    if (run.conclusion !== "success") console.log("失败原因多半是豆瓣拦截了 GitHub 的美国 IP，日志见上面的链接");
    break;
  }
}
