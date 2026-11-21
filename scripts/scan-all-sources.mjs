// 扫描全部日漫+日剧，标记哪些在 B 站有正版源可站内直接播
import fs from "node:fs/promises";
import { resolveEpisodes } from "../src/bili.mjs";

const ROOT = new URL("../", import.meta.url);
const cache = JSON.parse(await fs.readFile(new URL("data/cache.json", ROOT), "utf8"));
const out = [];
for (const kind of ["anime", "drama"]) {
  const list = cache[kind] || [];
  for (const it of list) {
    const r = await resolveEpisodes({ kind: it.kind, id: it.id, title: it.title, originalTitle: it.originalTitle, aka: it.aka });
    if (r && r.ok && r.episodes?.length) {
      out.push({ kind, id: it.id, title: it.title, biliTitle: r.title, seasonId: r.seasonId, eps: r.episodes.length,
        first: { n: r.episodes[0].n, bvid: r.episodes[0].bvid, link: r.episodes[0].link } });
    }
  }
  console.error("done", kind, out.length);
}
await fs.writeFile(new URL("data/playable.json", ROOT), JSON.stringify({ generatedAt: new Date().toISOString(), count: out.length, items: out }, null, 2));
console.log("playable", out.length);
