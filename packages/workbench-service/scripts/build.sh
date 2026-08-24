#!/usr/bin/env bash
# 单体编译（Task 11 / S-01）：
#   1. 构建前端（web 包存在时）→ 拷入 web-dist/index.html（编译期嵌入源，提交进仓）
#   2. bun build --compile 产出 dist/workbench.exe
# 构建 commit 经 --define 固化进二进制（实测：env 前缀对编译产物无效——
# contracts.ts 在运行时读 env；--define 才能把字面量成员表达式编译期替换）
set -euo pipefail

cd "$(dirname "$0")/.." # packages/workbench-service

# 1. 构建前端（若 web 包存在；缺失时沿用仓内 web-dist 现有产物）
if [ -d "../workbench-web" ]; then
  (cd ../workbench-web && bun run build)
  cp ../workbench-web/dist/index.html web-dist/index.html
fi

# 2. 编译单体（注入构建 commit）
mkdir -p dist
COMMIT_ID="$(git rev-parse --short HEAD 2>/dev/null || echo 'dev')"
bun build --compile \
  --define "process.env.WORKBENCH_BUILD_COMMIT_ID=\"${COMMIT_ID}\"" \
  src/main.ts --outfile dist/workbench.exe
echo "built: $(ls -la dist/workbench.exe | awk '{print $5}') bytes"
