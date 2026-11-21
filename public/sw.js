// 极简 Service Worker：外壳走缓存，数据永远取最新
const CACHE = "jp-tracker-v5";
// 必须用相对路径：站点部署在 https://<user>.github.io/<repo>/ 子路径下，
// 写成 "/"、"/app.js" 会解析到域名根目录并 404，导致 install 直接失败。
const SHELL = ["./", "./style.css", "./app.js", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;

  // 数据接口不缓存，保证看到的是最新抓取结果
  if (url.pathname.startsWith("/api/")) return;
  // 静态站的 data.json 每次都要取最新的（否则自动更新对老用户永远不生效）
  if (url.pathname.endsWith("/data.json")) return;

  // 网络优先：先拿最新外壳，离线或断网时才回退到缓存。
  // （以前是缓存优先，导致发版后老用户一直看旧的 app.js/index.html）
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("./")))
  );
});
