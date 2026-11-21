#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "正在启动…首次启动需要拉取数据，约 10-30 秒"
node server.mjs
