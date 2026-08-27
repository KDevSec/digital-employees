#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tools_dir="$root/tools"
. "$tools_dir/runtime-env.sh"

# Ensure Docker daemon is running
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Attempting to start..."
  if command -v systemctl >/dev/null 2>&1; then
    systemctl start docker 2>/dev/null || true
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "ERROR: Failed to start Docker daemon. Please start Docker manually." >&2
    exit 1
  fi
  echo "Docker daemon started successfully."
fi

"$tools_dir/ensure-certs.sh"

"$root/tools/compose.sh" up -d --build
"$root/tools/wait-for-http.sh" https://localhost:18080/realms/digital-employees/.well-known/openid-configuration 180
"$root/tools/wait-for-http.sh" https://localhost:18000/health/live 120
"$root/tools/sync-keycloak-urls.sh"
"$root/tools/wait-for-http.sh" https://localhost:18000/health/live 60
echo "Management platform: https://$PUBLIC_HOST:18000"
echo "Keycloak: https://$PUBLIC_HOST:18080"
