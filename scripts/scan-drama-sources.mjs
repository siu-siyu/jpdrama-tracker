// 扫描全部日剧，找出能在 B 站匹配到正版源的，按首播时间倒序输出
import fs from "node:fs/promises";
import { resolveEpisodes } from "../src/bili.mjs";

const cache = JSON.parse(await fs.readFile(new URL("../data/cache.json", import.meta.url), "utf8"));
const rows = [];
for (const it of cache.drama) {
  const r = await resolveEpisodes({ kind: it.kind, id: it.id, title: it.title, originalTitle: it.originalTitle, aka: it.aka });
  if (r.ok) {
    rows.push({
      id: it.id, title: it.title, pubdate: it.pubdate, rating: it.rating,
      bili: r.title, seasonId: r.seasonId, eps: r.episodes.length,
      first: r.episodes[0] && { n: r.episodes[0].n, title: r.episodes[0].title, long: r.episodes[0].longTitle, aid: r.episodes[0].aid, cid: r.episodes[0].cid, bvid: r.episodes[0].bvid, link: r.episodes[0].link },
      last: r.episodes.at(-1) && { n: r.episodes.at(-1).n, long: r.episodes.at(-1).longTitle, aid: r.episodes.at(-1).aid, cid: r.episodes.at(-1).cid, bvid: r.episodes.at(-1).bvid, link: r.episodes.at(-1).link },
    });
  }
}
rows.sort((a, b) => String(b.pubdate).localeCompare(String(a.pubdate)));
await fs.writeFile(new URL("../data/demo-scan.json", import.meta.url), JSON.stringify({ scanned: cache.drama.length, hits: rows.length, rows }, null, 2));
console.log("scanned", cache.drama.length, "hits", rows.length);
