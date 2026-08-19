#!/bin/sh
# 方案 A：为国内/受限网络环境配置 Docker 镜像加速器并预拉取基础镜像。
#
# 用途：解决 `./tools/up.sh` 构建 FROM 基础镜像时
#   `Get "https://registry-1.docker.io/v2/": context deadline exceeded` 类网络超时。
#
# 说明：
# - 仅需执行一次。基础镜像缓存到本地后，后续 `up.sh --build` 命中缓存、不再联网。
# - Dockerfile/compose 使用的镜像版本是钉死的（非 latest），不存在"每次拉最新"问题。
# - 本脚本会改写 /etc/docker/daemon.json 并重启 docker，需 root。
set -eu

MIRRORS='
  https://docker.m.daocloud.io
  https://dockerproxy.com
  https://docker.nju.edu.cn
  https://docker.1ms.run
'

BASE_IMAGES='
  python:3.11.6-slim
  node:22.22.0-alpine
  nginx:1.28-alpine
  postgres:18.4-alpine
  quay.io/keycloak/keycloak:26.7.0
'

[ "$(id -u)" -eq 0 ] || { echo "ERROR: 需要 root，请用 sudo 运行：sudo ./tools/configure-mirrors.sh" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || { echo "ERROR: 未找到 docker 命令" >&2; exit 1; }

# 1) 写入镜像加速器配置（保留已有 insecure-registries 等配置）
DAEMON_JSON=/etc/docker/daemon.json
mkdir -p /etc/docker
if [ -f "$DAEMON_JSON" ]; then
  cp "$DAEMON_JSON" "${DAEMON_JSON}.bak.$(date +%s)"
  echo "已备份原配置到 ${DAEMON_JSON}.bak.*"
fi

# 用 python 合并配置，避免简单覆盖丢失既有字段
if command -v python3 >/dev/null 2>&1; then
  MIRRORS_LIST="$MIRRORS" python3 - "$DAEMON_JSON" <<'PY'
import json, os, sys
path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
except FileNotFoundError:
    cfg = {}
mirrors = [m.strip() for m in os.environ["MIRRORS_LIST"].splitlines() if m.strip()]
existing = list(cfg.get("registry-mirrors", []))
for m in mirrors:
    if m not in existing:
        existing.append(m)
cfg["registry-mirrors"] = existing
with open(path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
PY
else
  # 无 python：直接写最小配置
  printf '{"registry-mirrors":[\n  https://docker.m.daocloud.io,\n  https://dockerproxy.com,\n  https://docker.nju.edu.cn,\n  https://docker.1ms.run\n]}\n' > "$DAEMON_JSON"
fi
echo "已写入 registry-mirrors 到 $DAEMON_JSON"

# 2) 重启 docker 使配置生效
echo "重启 docker ..."
systemctl restart docker 2>/dev/null || service docker restart
# 等待 docker 就绪
i=0
until docker info >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt 30 ] || { echo "ERROR: docker 未就绪" >&2; exit 1; }
  sleep 1
done
echo "docker 已就绪。生效的 mirrors："
docker info 2>/dev/null | grep -A4 "Registry Mirrors" || true

# 3) 预拉取基础镜像
echo ""
echo "开始预拉取基础镜像（首次较慢，请耐心等待）..."
fail=0
for img in $BASE_IMAGES; do
  printf "  -> %s ... " "$img"
  if docker pull "$img" >/dev/null 2>&1; then
    echo "OK"
  else
    echo "FAILED"
    fail=$((fail + 1))
  fi
done

echo ""
if [ "$fail" -gt 0 ]; then
  echo "WARNING: $fail 个镜像拉取失败。可能原因："
  echo "  1) 当前网络对加速器域名仍解析不通 -> 用 getent hosts docker.m.daocloud.io 排查"
  echo "  2) 所有加速器均不可用 -> 改用方案 B（离线 load）或方案 C（内网 harbor）"
  echo "  可手动 docker pull <img> 复试，或换其他可用加速器后重跑本脚本。"
  exit 2
fi

echo "全部基础镜像就绪。现在可以执行：./tools/up.sh"
