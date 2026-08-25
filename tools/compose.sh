#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tools_dir=$root/tools
. "$root/tools/runtime-env.sh"

env_file="$tools_dir/.env"
if [ ! -f "$env_file" ]; then
  echo "Creating tools/.env from .env.example (please review and customize)"
  cp "$tools_dir/.env.example" "$env_file"
fi

if docker compose version >/dev/null 2>&1; then
  exec docker compose --env-file "$env_file" -f "$tools_dir/compose.yml" "$@"
fi
exec "$tools_dir/.bin/docker-compose" --env-file "$env_file" -f "$tools_dir/compose.yml" "$@"
