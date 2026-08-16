#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tools_dir="$root/tools"
. "$tools_dir/runtime-env.sh"

platform_url="http://$PUBLIC_HOST:18000"
workbench_url="http://$PUBLIC_HOST:19820"

"$tools_dir/compose.sh" exec -T keycloak sh -s -- "$platform_url" "$workbench_url" <<'KEYCLOAK_SYNC'
set -eu

platform_url=$1
workbench_url=$2
kcadm=/opt/keycloak/bin/kcadm.sh

"$kcadm" config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" \
  --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null

update_client_urls() {
  client_name=$1
  redirect_uri=$2
  web_origin=$3
  internal_id=$("$kcadm" get clients -r digital-employees -q "clientId=$client_name" --fields id --format csv --noquotes | head -n 1 | tr -d '\r')
  if [ -z "$internal_id" ]; then
    echo "Keycloak client not found: $client_name" >&2
    exit 1
  fi
  "$kcadm" update "clients/$internal_id" -r digital-employees \
    -s "redirectUris=[\"$redirect_uri\"]" \
    -s "webOrigins=[\"$web_origin\"]" >/dev/null
}

update_client_urls platform-web "$platform_url/auth/callback" "$platform_url"
update_client_urls workbench-desktop "$workbench_url/auth/callback" "$workbench_url"

# Existing realms are not re-imported, so keep the IAM service account's least-privilege
# group/user management roles synchronized as part of every deployment.
for role in manage-users view-users query-users query-groups; do
  "$kcadm" add-roles -r digital-employees \
    --uusername service-account-platform-iam-sync \
    --cclientid realm-management \
    --rolename "$role" >/dev/null
done
KEYCLOAK_SYNC

echo "Keycloak client URLs synchronized for PUBLIC_HOST=$PUBLIC_HOST"
