#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tools_dir=$root
. "$root/runtime-env.sh"
if docker compose version >/dev/null 2>&1; then
  exec docker compose -f "$root/compose.yml" "$@"
fi
exec "$root/.bin/docker-compose" -f "$root/compose.yml" "$@"
