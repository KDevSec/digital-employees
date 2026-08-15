#!/bin/sh
set -eu
url=$1
limit=${2:-120}
elapsed=0
until curl --fail --silent --show-error "$url" >/dev/null 2>&1; do
  [ "$elapsed" -lt "$limit" ] || { echo "Timed out waiting for $url" >&2; exit 1; }
  sleep 2
  elapsed=$((elapsed + 2))
done
