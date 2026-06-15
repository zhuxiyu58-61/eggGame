@echo off
chcp 936 >nul
title 蛋蛋大冒险
cd /d "%~dp0"

echo ============================================
echo            蛋 蛋 大 冒 险   启 动
echo ============================================
echo.

rem --- 1. 检查 Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [X] 这台电脑还没装 Node.js。
  echo     先去 https://nodejs.org 下载 LTS 版，一路下一步装好，再双击我。
  echo.
  pause
  exit /b 1
)

rem --- 2. 拉最新代码（是 git 仓库 且 装了 git 才拉；拷贝来的没 .git 就跳过）---
if not exist ".git" (
  echo [1/4] 这是拷贝来的版本（无 .git），跳过更新，直接用当前文件。
) else (
  where git >nul 2>nul
  if errorlevel 1 (
    echo [1/4] 没装 git，跳过更新，用电脑里现有的版本。
  ) else (
    echo [1/4] 拉取最新代码...
    git pull origin main
  )
)
echo.

rem --- 3. 安装依赖（第一次运行 或 node_modules 不在 才装）---
if exist "node_modules" (
  echo [2/4] 依赖已就绪，跳过安装。
) else (
  echo [2/4] 第一次运行，正在安装依赖，要等几分钟，别关窗口...
  call npm install
  if errorlevel 1 (
    echo [X] 装依赖失败了，把上面红色的报错截图发我。
    pause
    exit /b 1
  )
)
echo.

rem --- 4. 构建 ---
echo [3/4] 正在构建游戏（约 10 多秒）...
call npm run build-nolog
if errorlevel 1 (
  echo [X] 构建失败了，把上面的报错截图发我。
  pause
  exit /b 1
)
echo.

rem --- 5. 起本地服务并自动打开浏览器 ---
echo [4/4] 启动完成！浏览器会自动打开游戏。
echo.
echo     ★ 玩好了，直接关掉这个黑色窗口就结束 ★
echo.
call npm run preview
pause
