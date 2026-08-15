#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tools_dir="$root/tools"
. "$tools_dir/runtime-env.sh"
"$root/tools/compose.sh" up -d --build
"$root/tools/wait-for-http.sh" http://localhost:18080/realms/digital-employees/.well-known/openid-configuration 180
"$root/tools/wait-for-http.sh" http://localhost:18000/health/live 120
"$root/tools/wait-for-http.sh" http://localhost:19820/health/live 120
"$root/tools/sync-keycloak-urls.sh"
echo "Management platform: http://$PUBLIC_HOST:18000"
echo "Keycloak: http://$PUBLIC_HOST:18080"
echo "Workbench: http://$PUBLIC_HOST:19820"
