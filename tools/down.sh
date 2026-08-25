#!/bin/sh
# 停止全部容器，并可选清理无用 Docker 层。
#
# 用法：
#   ./tools/down.sh              # 停止容器（保留数据卷和镜像）
#   ./tools/down.sh --volumes    # 停止并删除数据卷（等同 -v）
#   ./tools/down.sh -p           # 停止后自动清理悬空镜像和构建缓存（同 --prune）
#   ./tools/down.sh -P           # 停止后清理所有未使用镜像（同 --prune-all，含基础镜像，需重新拉取）
#   ./tools/down.sh --rmi local  # 停止后删除本地构建的镜像（compose 原生参数）
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

PRUNE_MODE=0
COMPOSE_DOWN_ARGS=""

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      sed -n '2,/^set -eu/{/^set -eu/!p}' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    -p|--prune)
      PRUNE_MODE=1
      shift
      ;;
    -P|--prune-all)
      PRUNE_MODE=2
      shift
      ;;
    *)
      COMPOSE_DOWN_ARGS="$COMPOSE_DOWN_ARGS $1"
      shift
      ;;
  esac
done

# shellcheck disable=SC2086
"$root/tools/compose.sh" down $COMPOSE_DOWN_ARGS

if [ "$PRUNE_MODE" -ge 1 ]; then
  echo ""
  if [ "$PRUNE_MODE" -eq 2 ]; then
    echo "down 完成，开始激进清理所有未使用镜像..."
    "$root/tools/prune.sh" --all --containers
  else
    echo "down 完成，开始清理悬空镜像和构建缓存..."
    "$root/tools/prune.sh"
  fi
fi
