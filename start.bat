@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 追番日剧 · 日漫日剧中文情报站

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org
  pause
  exit /b 1
)

echo 正在启动…首次启动会拉取豆瓣数据，约 10-30 秒
echo 手机连同一个 Wi-Fi，用窗口中显示的「手机访问」地址即可。
echo.
start "" /min cmd /c "timeout /t 5 >nul & start "" http://127.0.0.1:7788"
node server.mjs
pause
