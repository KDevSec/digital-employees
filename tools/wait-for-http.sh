#!/bin/sh
set -eu
url=$1
limit=${2:-120}
elapsed=0
until curl --fail --silent --show-error "$url" >/dev/null 2>&1; do
  [ "$elapsed" -lt "$limit" ] || {
    echo "Timed out waiting for $url (after ${elapsed}s)" >&2
    # 超时后打印疑似未就绪服务的容器日志，便于定位根因
    case "$url" in
      *:18080*) svc="keycloak" ;;
      *:18000*) svc="platform-api" ;;
      *) svc="" ;;
    esac
    if [ -n "$svc" ]; then
      echo "--- docker logs (tail, $svc) ---" >&2
      docker ps -a --filter "name=digital-employees.*-${svc}-1" --format '{{.Names}}' 2>/dev/null \
        | while read -r c; do
            echo "[$c]" >&2
            docker logs --tail 30 "$c" 2>&1 >&2
          done
    fi
    exit 1
  }
  sleep 2
  elapsed=$((elapsed + 2))
done
