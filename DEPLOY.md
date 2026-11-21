# 部署与自动更新（已上线，无需手动操作）

线上地址：**https://siu-siyu.github.io/jpdrama-tracker/**

站点完全托管在 GitHub Pages 上：不用开这台笔记本、不用公网 IP、不用域名，全球可访问（国内一般也能打开，偶尔慢）。数据每 6 小时由 GitHub Actions 自动重新抓取并重新发布。

仓库：https://github.com/siu-siyu/jpdrama-tracker

---

## 一、它是怎么跑的

```
GitHub Actions（cron 17 */6 * * *，即每 6 小时的 :17）
  └─ node scripts/build-static.mjs --fetch
       ├─ 抓豆瓣列表 + 详情（data/cache.json、data/details.json，跨次复用）
       ├─ 解析 B 站分集（data/episodes.json，随仓库提交，见下方说明）
       ├─ 封面下载进 dist/covers/
       └─ 生成 dist/（静态站，含 data.json）
  └─ actions/upload-pages-artifact + actions/deploy-pages
       └─ 发布到 https://siu-siyu.github.io/jpdrama-tracker/
```

关键文件：

- `.github/workflows/update.yml`：定时任务本体，改 `cron` 即可改频率。
- `scripts/build-static.mjs`：抓数据 + 烘焙分集 + 下载封面 + 导出 `dist/`。
- `scripts/gh-deploy.mjs`：把本机源码推上仓库并触发一次构建（本机网络访问 github.com 的 git 协议被污染，只能用 api.github.com 上传）。
- `scripts/gh-auth.mjs`：GitHub 设备码登录，token 存在 `data/.gh-token`（已 gitignore）。

## 二、关于 B 站分集（重要）

GitHub 的服务器在美国，访问 `api.bilibili.com` 会被风控拦截（日志里的 `412`），所以**Actions 里解析不到任何分集**。

解决办法：把本机解析好的结果 `data/episodes.json` 提交进仓库，构建时直接命中缓存
（`BILI_TTL_DAYS=365`、`BILI_TTL_MISS_HOURS=720` 在 workflow 里设置，避免缓存过期后去撞 412）。

后果与限制：

- 站点的「点开就能看」覆盖范围 = 本机最后一次扫描的结果（目前 5 部）。
- 豆瓣数据（新剧上架、评分、简介、放送进度）仍然每 6 小时自动更新。
- 想让新剧也能直接看：在这台机器上跑一次

```bash
node scripts/scan-all-sources.mjs      # 重新扫全部条目，更新 data/episodes.json
node scripts/gh-deploy.mjs             # 推上去并触发构建（约 5~8 分钟）
```

## 三、常见操作

**手动触发一次更新**

GitHub 仓库 → Actions → 「刷新放送数据并发布到 GitHub Pages」→ Run workflow。

**改更新频率**

编辑 `.github/workflows/update.yml` 的 `cron: "17 */6 * * *"`（UTC）：

- `"17 */3 * * *"` 每 3 小时
- `"17 20 * * *"` 每天北京时间 04:17 一次

**本地预览线上效果**

```bash
node scripts/build-static.mjs --fetch   # 生成 dist/
node scripts/serve-dist.mjs             # http://127.0.0.1:7799
```

**本地开发（动态版，带 /api/refresh）**

```bash
node server.mjs                          # http://127.0.0.1:7788
```

## 四、排错

| 现象 | 原因 / 处理 |
| --- | --- |
| Actions 红叉，日志报豆瓣请求失败 | 豆瓣对境外 IP 限流；等下一次 cron 或在本机 `--fetch` 后手动推 |
| 站点打开是空白页 | 检查 `dist/index.html` 是否注入了 `window.__STATIC__ = true`，以及资源路径是否为 `./` 相对路径 |
| 有剧却没有分集按钮 | 该剧 B 站没有正版片源，或本机缓存里是未命中记录 |
| 封面空白 | `dist/covers/` 缺图（豆瓣图床 418），重新跑一次构建即可 |
| 手机上打开是旧版本 | 页面注册了 `sw.js` 离线缓存；下拉刷新或清一次站点数据 |

## 五、手机上装成 App

- **安卓**：项目里的 `public/app.apk` 是 WebView 壳，默认指向局域网地址，长按页面可改地址；公网版把地址改成 https://siu-siyu.github.io/jpdrama-tracker/ 即可。
- **iPhone / 鸿蒙**：用浏览器打开线上地址 → 分享 → 「添加到主屏幕」，图标和全屏体验与原生 App 一致。
