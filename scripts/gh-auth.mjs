#!/usr/bin/env node
// GitHub OAuth 设备流：本机 DNS 被污染（github.com 解析到 57.155.223.240 超时），
// 所以统一走固定 IP + SNI 的 https 请求。token 只写进 data/.gh-token（data/ 已被 gitignore）。
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const IPS = ["20.205.243.166", "140.82.112.3", "140.82.114.4"];
export const CLIENT_ID = "178c6fc778ccc68e1d6a";

const agentCache = new Map();

function request(host, method, reqPath, json, form) {
  const body = form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : "";
  return new Promise((resolve, reject) => {
    const ip = agentCache.get(host) || IPS[0];
    const req = https.request({
      host: ip, port: 443, method, path: reqPath, servername: host, timeout: 20000,
      headers: {
        Host: host, "user-agent": "jpdrama-deploy", accept: "application/json",
        "content-type": form ? "application/x-www-form-urlencoded" : "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (buf += d));
      res.on("end", () => {
        if (res.statusCode === 302 || res.statusCode === 301) return resolve({ status: res.statusCode, location: res.headers.location, text: buf });
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch { parsed = null; }
        resolve({ status: res.statusCode, data: parsed, text: buf });
      });
    });
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", (e) => {
      // 换一个 IP 重试一次
      const next = IPS.filter((x) => x !== ip);
      agentCache.set(host, next[0] || ip);
      reject(e);
    });
    req.end(body);
  });
}

async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; }
  }
  throw last;
}

if (process.argv[1] && process.argv[1].endsWith("gh-auth.mjs")) {
  const mode = process.argv[2] || "start";
  if (mode === "start") {
    const res = await withRetry(() => request("github.com", "POST", "/login/device/code", null, { client_id: CLIENT_ID, scope: "repo workflow" }));
    if (!res.data?.device_code) { console.log("失败：" + (res.text || "").slice(0, 200)); process.exit(1); }
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, ".gh-device.json"), JSON.stringify(res.data));
    console.log(JSON.stringify({ user_code: res.data.user_code, verification_uri: res.data.verification_uri, expires_in: res.data.expires_in, interval: res.data.interval }));
  } else if (mode === "poll") {
    const dev = JSON.parse(fs.readFileSync(path.join(DATA, ".gh-device.json"), "utf8"));
    const interval = Math.max(5, dev.interval || 5) * 1000;
    const deadline = Date.now() + (dev.expires_in || 900) * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      let res;
      try {
        res = await withRetry(() => request("github.com", "POST", "/login/oauth/access_token", null, {
          client_id: CLIENT_ID, device_code: dev.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }), 2);
      } catch (e) { console.log("网络重试：" + e.message); continue; }
      const d = res.data || {};
      if (d.access_token) {
        fs.writeFileSync(path.join(DATA, ".gh-token"), d.access_token, { mode: 0o600 });
        console.log("AUTHORIZED");
        process.exit(0);
      }
      if (d.error === "authorization_pending") { console.log("等待授权…"); continue; }
      if (d.error === "slow_down") { await new Promise((r) => setTimeout(r, interval)); continue; }
      console.log("结束：" + (d.error || res.text.slice(0, 120)));
      process.exit(1);
    }
    console.log("已过期，请重新生成授权码");
    process.exit(1);
  }
}
