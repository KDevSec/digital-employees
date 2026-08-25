#!/usr/bin/env bash
# DevZero 安装包构建（设计 §4 构建链）：
#   1. 前置检查：三制品已在 workbench-service/dist（不代跑上游构建，对齐 build-tray.sh 形态）
#   2. 版本注入：读 workbench-service/package.json version -> iscc -D（安装包版本 = 服务主版本线）
#   3. iscc 编译 -> dist/devzero-setup-<version>-x64.exe + 同名 .sha256（平台上传 U-02 直接消费）
#   4. signtool 挂点（裁决 4 预留位）：WORKBENCH_SIGN_CERT 存在才签名，否则跳过
set -euo pipefail

cd "$(dirname "$0")/.." # workbench/workbench-installer

DIST="../workbench-service/dist"
for f in devzero.exe devzero-daemon.exe devzero-tray.exe; do
  [ -f "$DIST/$f" ] || { echo "[build-installer] $DIST/$f 缺失--先跑 service/build.sh 与 tray/build-tray.sh"; exit 1; }
done

# iscc 探测：PATH > 默认安装路径（winget 装机不自动进 PATH）
ISCC="${ISCC_PATH:-}"
if [ -z "$ISCC" ]; then
  for c in iscc "/c/Program Files (x86)/Inno Setup 6/ISCC.exe" "/c/Program Files/Inno Setup 6/ISCC.exe"; do
    if command -v "$c" >/dev/null 2>&1; then ISCC="$c"; break; fi
  done
fi
[ -n "$ISCC" ] || { echo "[build-installer] iscc.exe 未找到--先装 Inno Setup 6 或设 ISCC_PATH"; exit 1; }

# 版本注入（设计 §4：安装包版本 = 服务主版本线；壳版本独立线 W-12 不进）
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' ../workbench-service/package.json | head -1)"
[ -n "$VERSION" ] || { echo "[build-installer] package.json version 读取失败"; exit 1; }

OUT="$DIST/devzero-setup-$VERSION-x64.exe"
"$ISCC" -DMyAppVersion="$VERSION" workbench.iss
SIZE="$(stat -c%s "$OUT")"
echo "[build-installer] built: $OUT ($SIZE bytes)"

# sha256 产物（U-02 平台上传直接消费）
sha256sum "$OUT" | awk '{print $1}' > "$OUT.sha256"
echo "[build-installer] sha256: $(cat "$OUT.sha256")"

# signtool 挂点（裁决 4：无证书零开销跳过）
if [ -n "${WORKBENCH_SIGN_CERT:-}" ]; then
  signtool sign /fd SHA256 /f "$WORKBENCH_SIGN_CERT" ${WORKBENCH_SIGN_P:+/p "$WORKBENCH_SIGN_P"} "$OUT" \
    && echo "[build-installer] 已签名" || echo "[build-installer] 签名失败（继续，signature_status 报 UNVERIFIED）"
else
  echo "[build-installer] 未设 WORKBENCH_SIGN_CERT--跳过签名（signature_status=UNVERIFIED）"
fi
