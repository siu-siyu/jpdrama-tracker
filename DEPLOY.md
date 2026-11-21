# 部署到公网（免费，一次性配置）

目标：站点挂在公网上，任何设备、任何网络都能打开，**不用开着这台笔记本**，并且每 6 小时自动更新一次数据。

整套方案 = GitHub 仓库（存代码和生成的 dist/）+ GitHub Actions（定时抓数据、生成静态站、自动提交）+ Cloudflare Pages（托管 dist/，全球 CDN，免费）。

---

## 一、把代码推到 GitHub（约 3 分钟）

1. 打开 https://github.com/new ，仓库名填 `jpdrama-tracker`，**Private（私有）也可以**，不要勾选任何 README / .gitignore 模板，点 Create repository。
2. 在这个项目目录（D:\工作文档\jpdrama-tracker）打开命令行，执行（把 `<你的用户名>` 换成 GitHub 用户名）：

```bash
git remote add origin https://github.com/<你的用户名>/jpdrama-tracker.git
git branch -M main
git push -u origin main
```

3. 推送时会要求登录：弹出浏览器就点授权；如果在命令行要密码，请填 **Personal Access Token**（https://github.com/settings/tokens 生成，勾选 repo 权限），不是账号密码。

> 仓库里已经包含 `dist/`（14MB，160 部剧的静态站 + 封面），所以推上去之后 Cloudflare 马上就能用。

## 二、在 Cloudflare Pages 建站（约 3 分钟）

1. 注册 / 登录 https://dash.cloudflare.com （免费账号即可，不要求有域名）。
2. 左侧选 **Workers & Pages** → **Create** → 选 **Pages** → **Connect to Git**。
3. 授权 GitHub，选中刚才的 `jpdrama-tracker` 仓库，点 Begin setup。
4. 构建设置这样填：
   - Project name：`jpdrama`（决定网址 `https://jpdrama.pages.dev`，可自定义）
   - Production branch：`main`
   - Framework preset：**None**
   - Build command：**留空**
   - Build output directory：`dist`
5. 点 **Save and Deploy**，等 1 分钟，访问 `https://<项目名>.pages.dev`。

之后每次仓库有新的提交，Cloudflare 会自动重新部署，无需再操作。

## 三、打开自动更新（约 1 分钟）

1. 进 GitHub 仓库 → **Settings** → **Actions** → **General** → 找到 *Workflow permissions*，选 **Read and write permissions** → Save。（否则定时任务无法把新数据提交回仓库）
2. 进 **Actions** 标签页 → 左侧 *刷新放送数据* → 右侧 **Run workflow** 手动跑一次，确认是绿勾。
3. 之后它按 `.github/workflows/update.yml` 里的 `cron: "17 */6 * * *"`（每 6 小时）自动跑：抓豆瓣 → 解析 B 站分集 → 重新生成 dist/ → 提交 → Cloudflare 自动部署。

想改频率就改那行 cron（UTC 时间）：`"17 */3 * * *"` 是每 3 小时，`"17 20 * * *"` 是每天北京时间 04:17 一次。

## 四、验证与常见问题

**先看 Actions 日志里有没有 `warnings`**：GitHub 的服务器在美国，豆瓣有可能对境外 IP 限流。手动 Run 一次后：

- 绿勾 + 日志里 `anime 80 / drama 80` → 一切正常。
- 红叉，报 `豆瓣列表请求失败` → 境外 IP 被拦。此时有两个选择：
  1. 在本机跑 `node scripts/build-static.mjs --fetch`，然后 `git add -A dist && git commit -m update && git push`（笔记本开着的时候手动更新）；
  2. 把 workflow 里的抓取步骤换成走你自己的代理（改 `fetchJSON` 的 `proxy` 参数）。
- Cloudflare 部署成功但页面空白 → 检查 Build output directory 是否真的填了 `dist`（不是 `/dist`、不是 `public`）。

**国内访问 pages.dev 有时慢或被墙**：在 Cloudflare Pages 项目里 **Custom domains** 绑定自己的域名（阿里云/腾讯云买的域名都行，把 DNS 交给 Cloudflare 即可），访问会稳定很多。

**手机上装成 App**：用手机浏览器打开站点 → 分享/菜单 → 「添加到主屏幕」，图标和全屏体验与原生 App 一致。安卓也可以用项目里的 `app.apk`，但那个壳指向局域网地址，公网版建议直接用「添加到主屏幕」。

## 五、本地预览静态站

```bash
node scripts/build-static.mjs        # 用本地缓存生成 dist/
node scripts/serve-dist.mjs          # http://127.0.0.1:7799
```

加了 `--fetch` 会先联网刷新豆瓣数据再生成。

## 六、成本

GitHub 私有仓库 + Actions（每月 2000 分钟，本站每次约 5 分钟，6 小时一次 ≈ 每月 600 分钟）+ Cloudflare Pages（免费额度：每月 500 次构建、无限带宽）。**0 元**。
