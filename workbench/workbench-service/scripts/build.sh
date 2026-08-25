#!/usr/bin/env bash
# 单体编译（Task 11 / S-01 + 安装实测修正）：
#   1. 构建前端（web 包存在时）→ 拷入 web-dist/index.html（编译期嵌入源，提交进仓）
#   2. bun build --compile 产出双变体：
#      - devzero.exe          console 子系统（CLI 面：status/stop 需要控制台输出）
#      - devzero-daemon.exe GUI 子系统（--windows-hide-console，计划任务守护专用——
#        零控制台闪现；替代 VBS 隐藏包装：wscript+VBS+隐藏+任务=恶意软件 TTP 查杀模式，
#        且微软正废弃 VBScript）
#      两变体均内嵌 VersionInfo（--windows-title/publisher/version，设计 §15：不泄露构建工具名）
# 构建 commit 经 --define 固化进二进制（实测：env 前缀对编译产物无效——
# contracts.ts 在运行时读 env；--define 才能把字面量成员表达式编译期替换）
set -euo pipefail

cd "$(dirname "$0")/.." # workbench/workbench-service

# 1. 构建前端（若 web 包存在；缺失时沿用仓内 web-dist 现有产物）
if [ -d "../workbench-web" ]; then
  (cd ../workbench-web && bun run build)
  cp ../workbench-web/dist/index.html web-dist/index.html
fi

# 2. 编译单体（注入构建 commit + 版本信息）
mkdir -p dist
COMMIT_ID="$(git rev-parse --short HEAD 2>/dev/null || echo 'dev')"
WB_VERSION="$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo 0.1.0)"

bun build --compile \
  --define "process.env.WORKBENCH_BUILD_COMMIT_ID=\"${COMMIT_ID}\"" \
  --windows-title "DevZero" \
  --windows-publisher "Placeholder" \
  --windows-version "${WB_VERSION}" \
  src/main.ts --outfile dist/devzero.exe

bun build --compile \
  --define "process.env.WORKBENCH_BUILD_COMMIT_ID=\"${COMMIT_ID}\"" \
  --windows-hide-console \
  --windows-title "DevZero" \
  --windows-publisher "Placeholder" \
  --windows-version "${WB_VERSION}" \
  src/main.ts --outfile dist/devzero-daemon.exe
# Bun 1.3.9 的 --windows-hide-console 实测不翻 PE Subsystem（产物仍 CUI）——后处理翻字节：
# CLI 子系统编译（保住 VersionInfo 旗标效果）+ 翻 GUI 子系统 = 零闪现守护变体
bun run scripts/flip-subsystem.ts dist/devzero-daemon.exe dist/devzero-daemon.exe

echo "built: cli=$(stat -c%s dist/devzero.exe) daemon=$(stat -c%s dist/devzero-daemon.exe) bytes"
