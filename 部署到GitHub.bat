@echo off
chcp 65001 >nul
setlocal

echo ============================================
echo   把追番日剧站推到 GitHub（推完即可上公网）
echo ============================================
echo.
echo 第 1 步：马上会打开 GitHub 新建仓库页面
echo   - 仓库名填 jpdrama-tracker
echo   - 不要勾选 README / .gitignore / license
echo   - 点 Create repository
echo.
pause
start https://github.com/new

echo.
set /p REPO=第 2 步：输入 用户名/仓库名（例如 zhangsan/jpdrama-tracker）:
if "%REPO%"=="" goto :empty

cd /d "%~dp0"
git remote remove origin >nul 2>&1
git remote add origin https://github.com/%REPO%.git
git branch -M main
echo.
echo 正在推送，若弹出浏览器请登录 GitHub 并授权...
git push -u origin main
if errorlevel 1 (
  echo.
  echo [失败] 推送没成功。常见原因：
  echo   1) 仓库名写错或仓库还没创建
  echo   2) 登录窗口被关掉了：重新运行本文件即可
  echo   3) 网络问题：换个时间再试
  pause
  exit /b 1
)
echo.
echo [成功] 代码已经在 https://github.com/%REPO%
echo.
echo 第 3 步（在浏览器里做，约 3 分钟）：
echo   1. 打开 https://dash.cloudflare.com 注册/登录（免费）
echo   2. Workers ^& Pages - Create - Pages - Connect to Git
echo   3. 选中 %REPO% 仓库
echo   4. Framework preset = None，Build command 留空，Build output directory 填 dist
echo   5. Save and Deploy，等 1 分钟，得到 https://xxx.pages.dev
echo   6. 到 GitHub 仓库 Settings - Actions - General，把 Workflow permissions 改成 Read and write
echo   7. 到 Actions 页面手动 Run workflow 一次，确认变绿
echo.
echo 详细图文步骤见 DEPLOY.md
pause
exit /b 0

:empty
echo 没有输入仓库名，已取消。
pause
