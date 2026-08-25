#!/usr/bin/env bash
# 托盘构建（Task 16 / TR-09 双制品同目录）：
#   1. 确保 service 的 dist/workbench.exe 存在（缺失则先触发 service 构建）——托盘 exe 与
#      service exe 同目录兄弟落位（main.go 的 serviceExe = dirname(os.Executable())/workbench.exe）
#   2. TR-08 版本资源：versioninfo/versioninfo.json → resource.syso（go build 自动嵌入）；
#      工具不可用（离线等）时沿用仓内已提交的 resource.syso——版本资源缺失不影响功能
#   3. go build -ldflags "-H windowsgui -s -w" -o ../workbench-service/dist/workbench-tray.exe
set -euo pipefail

cd "$(dirname "$0")/.." # workbench/workbench-tray

SERVICE_DIST="../workbench-service/dist/workbench.exe"
TRAY_OUT="../workbench-service/dist/workbench-tray.exe"

if [ ! -f "$SERVICE_DIST" ]; then
  echo "[build-tray] service 制品缺失，先构建 service（$SERVICE_DIST）"
  (cd ../workbench-service && bash scripts/build.sh)
fi

# TR-08 版本资源再生成（注：本版 goversioninfo 无 -platform 旗标，64 位默认开即 amd64；
# 版本钉死避免 @latest 每次构建查代理）。失败降级沿用仓内 syso。
if go run github.com/josephspurrier/goversioninfo/cmd/goversioninfo@v1.7.0 \
  -o resource.syso versioninfo/versioninfo.json 2>/dev/null; then
  echo "[build-tray] resource.syso 已按 versioninfo/versioninfo.json 重新生成"
elif [ -f resource.syso ]; then
  echo "[build-tray] goversioninfo 不可用，沿用仓内已提交的 resource.syso"
else
  echo "[build-tray] 警告：goversioninfo 不可用且仓内无 resource.syso——本次构建缺版本资源（TR-08 降级）"
fi

mkdir -p ../workbench-service/dist
go build -ldflags "-H windowsgui -s -w" -o "$TRAY_OUT" .
SIZE="$(stat -c%s "$TRAY_OUT")"
echo "[build-tray] built: $TRAY_OUT ($SIZE bytes)"
