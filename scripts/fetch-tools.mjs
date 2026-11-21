// 下载构建 Android APK 所需的工具链（JDK + Android build-tools + platform）
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const OUT = path.resolve(".tools/dl");
const FILES = [
  ["jdk.zip", "https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.21_9.zip"],
  ["build-tools.zip", "https://dl.google.com/android/repository/build-tools_r34-windows.zip"],
  ["platform-33.zip", "https://dl.google.com/android/repository/platform-33-ext5_r01.zip"],
];

fs.mkdirSync(OUT, { recursive: true });

for (const [name, url] of FILES) {
  const dest = path.join(OUT, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
    console.log("skip", name, fs.statSync(dest).size);
    continue;
  }
  const t0 = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(1800000) });
  if (!res.ok) throw new Error(name + " HTTP " + res.status);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  const mb = (fs.statSync(dest).size / 1048576).toFixed(1);
  console.log("done", name, mb + "MB", ((Date.now() - t0) / 1000).toFixed(1) + "s");
}
console.log("all downloaded");
