#!/bin/sh
# 清理 Docker 无用层、悬空镜像和构建缓存，避免反复 docker build 导致
# /var/lib/docker/overlay2 层数和磁盘占用无限增长。
#
# 用法：
#   ./tools/prune.sh              # 安全清理：仅删悬空镜像 + 构建缓存（推荐日常使用）
#   ./tools/prune.sh --all        # 激进清理：额外删除所有未被容器使用的镜像（含其他项目）
#   ./tools/prune.sh --containers # 额外清理所有已停止的容器
#   ./tools/prune.sh --dry-run    # 只报告将回收多少空间，不实际删除
#
# 说明：
# - 默认模式只删除 dangling image（无标签的旧构建层）和 build cache，
#   不会影响正在运行的容器、已标记的镜像或数据卷。
# - --all 会删除所有未被任何容器引用的镜像（包括公共基础镜像），
#   下次 up.sh 需要重新 pull/构建，请谨慎使用。
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

DRY_RUN=0
PRUNE_ALL=0
PRUNE_CONTAINERS=0

for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --all)        PRUNE_ALL=1 ;;
    --containers) PRUNE_CONTAINERS=1 ;;
    -h|--help)
      sed -n '2,/^set -eu/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "ERROR: 未知参数: $arg" >&2
      echo "用法: $0 [--dry-run] [--all] [--containers]" >&2
      exit 1
      ;;
  esac
done

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon 未运行，请先启动 Docker。" >&2
  exit 1
fi

# 采集清理前磁盘占用
echo "=== Docker 清理前状态 ==="
docker system df 2>/dev/null || true
echo ""

if [ "$DRY_RUN" -eq 1 ]; then
  echo "=== DRY RUN 模式：以下操作不会实际执行 ==="
  echo ""
fi

run_prune() {
  label="$1"; shift
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[DRY RUN] 将执行: docker $*"
  else
    echo "--- $label ---"
    docker "$@"
    echo ""
  fi
}

# 1) 悬空镜像（最常见、最安全：旧构建产生的无标签层）
run_prune "清理悬空镜像 (dangling images)" image prune -f

# 2) 构建缓存（BuildKit 缓存的中间层）
run_prune "清理构建缓存 (build cache)" builder prune -f

# 3) 可选：停止的容器
if [ "$PRUNE_CONTAINERS" -eq 1 ]; then
  run_prune "清理已停止的容器 (stopped containers)" container prune -f
fi

# 4) 可选：未使用的网络（compose down 有时会遗留）
run_prune "清理未使用的网络 (unused networks)" network prune -f

# 5) 激进模式：所有未被容器使用的镜像
if [ "$PRUNE_ALL" -eq 1 ]; then
  echo "WARNING: --all 将删除所有未被容器使用的镜像（包括公共基础镜像）。" >&2
  echo "         下次 ./tools/up.sh 将重新拉取/构建镜像。" >&2
  echo ""
  run_prune "清理所有未使用镜像 (all unused images)" image prune -a -f
fi

if [ "$DRY_RUN" -eq 0 ]; then
  echo "=== Docker 清理后状态 ==="
  docker system df 2>/dev/null || true
  echo ""
  echo "清理完成。"
else
  echo ""
  echo "DRY RUN 完成。如确认无误，去掉 --dry-run 重新执行以实际清理。"
fi
