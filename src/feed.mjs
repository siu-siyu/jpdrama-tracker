// RSS 2.0 输出：阅读器里直接看「最近开播 / 更新了哪些」
import { rfc822 } from "./util.mjs";

export function buildRss(cache, origin, hours) {
  const items = [];

  for (const kind of ["anime", "drama"]) {
    const label = kind === "anime" ? "日漫" : "日剧";
    for (const it of cache?.[kind] ?? []) {
      const date = it.pubdate ? Date.parse(it.pubdate + "T12:00:00+08:00") : Date.now();
      items.push({
        title: "【" + label + "】" + it.title + (it.rating ? " · " + it.rating.toFixed(1) + "分" : ""),
        link: it.doubanUrl,
        guid: kind + "-" + it.id,
        date,
        desc:
          (it.year ? it.year + " · " : "") +
          (it.episodes ? "全 " + it.episodes + " 集 · " : "") +
          (it.originalTitle ? it.originalTitle + " · " : "") +
          (it.intro || ""),
      });
    }
  }

  items.sort((a, b) => b.date - a.date);

  const body = items
    .slice(0, 120)
    .map((it) =>
      [
        "    <item>",
        "      <title><![CDATA[" + it.title + "]]></title>",
        "      <link>" + it.link + "</link>",
        '      <guid isPermaLink="false">' + it.guid + "</guid>",
        "      <pubDate>" + rfc822(it.date) + "</pubDate>",
        "      <description><![CDATA[" + it.desc + "]]></description>",
        "    </item>",
      ].join("\n")
    )
    .join("\n");

  const built = cache?.updatedAt ? rfc822(Date.parse(cache.updatedAt)) : rfc822(Date.now());
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n' +
    "    <title>日漫 / 日剧 中文追番</title>\n" +
    "    <link>" + origin + "/</link>\n" +
    "    <description>每 " + hours + " 小时自动更新，中文剧名与评分，附豆瓣 / B站 观看入口</description>\n" +
    "    <language>zh-cn</language>\n" +
    "    <lastBuildDate>" + built + "</lastBuildDate>\n" +
    body +
    "\n  </channel>\n</rss>\n"
  );
}
