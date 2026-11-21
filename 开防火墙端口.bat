@echo off
chcp 65001 >nul
setlocal
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo 需要管理员权限，正在弹出 UAC 请求提权，请点【是】...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo ============================================
echo 1) 删除 Windows 给 node.exe 建的【阻止】规则
echo    （阻止规则优先级高于允许规则，不删掉永远连不上）
netsh advfirewall firewall delete rule name="Node.js JavaScript Runtime" >nul 2>&1
netsh advfirewall firewall delete rule name=all program="D:\node.js\node.exe" dir=in >nul 2>&1
echo 2) 放行 TCP 7788 入站（所有网络类型）
netsh advfirewall firewall delete rule name="JPTracker-7788" >nul 2>&1
netsh advfirewall firewall add rule name="JPTracker-7788" dir=in action=allow protocol=TCP localport=7788 profile=any enable=yes >nul
echo 3) 放行 node.exe 入站（所有网络类型）
netsh advfirewall firewall delete rule name="JPTracker-node" >nul 2>&1
netsh advfirewall firewall add rule name="JPTracker-node" dir=in action=allow program="D:\node.js\node.exe" profile=any enable=yes >nul
echo 4) 结果校验：
echo --- 现有 JPTracker 规则 ---
netsh advfirewall firewall show rule name="JPTracker-7788" dir=in | findstr /i "Rule Name Enabled Action LocalPort
netsh advfirewall firewall show rule name="JPTracker-node" dir=in | findstr /i "Rule Name Enabled Action Program
echo --- 当前网络类型状态 ---
netsh advfirewall show allprofiles state
echo ============================================
echo 完成。请用平板/手机浏览器打开：http://192.168.0.104:7788
echo 如果还是打不开，把本窗口截图发给助手。
echo.
pause