#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tools_dir="$root/tools"
. "$tools_dir/runtime-env.sh"

platform_url="https://$PUBLIC_HOST:18000"

"$tools_dir/compose.sh" exec -T keycloak sh -s -- "$platform_url" <<'KEYCLOAK_SYNC'
set -eu

platform_url=$1
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
  post_logout_uri=$4
  backchannel_url=$5

  internal_id=$("$kcadm" get clients -r digital-employees -q "clientId=$client_name" --fields id --format csv --noquotes | head -n 1 | tr -d '\r')
  if [ -z "$internal_id" ]; then
    echo "Keycloak client not found: $client_name" >&2
    exit 1
  fi

  # kcadm deep-merges attributes; set only the keys we own.
  client_attrs='{"pkce.code.challenge.method":"S256"'
  if [ -n "$post_logout_uri" ]; then
    client_attrs="$client_attrs,\"post.logout.redirect.uris\":\"$post_logout_uri\""
  fi
  if [ -n "$backchannel_url" ]; then
    client_attrs="$client_attrs,\"backchannel.logout.url\":\"$backchannel_url\""
  fi
  client_attrs="$client_attrs}"

  "$kcadm" update "clients/$internal_id" -r digital-employees \
    -s "redirectUris=[\"$redirect_uri\"]" \
    -s "webOrigins=[\"$web_origin\"]" \
    -s "attributes=$client_attrs" >/dev/null
}

update_client_urls platform-web "$platform_url/auth/callback" "$platform_url" "$platform_url/" "${PLATFORM_INTERNAL_URL}/auth/backchannel-logout"

# workbench-desktop runs on each end user's own machine (bound to 127.0.0.1:19980);
# the OAuth redirect is a browser-side jump to the user's own loopback, so the URIs
# are fixed loopback values and must NOT use the server's PUBLIC_HOST.
wb_id=$("$kcadm" get clients -r digital-employees -q "clientId=workbench-desktop" --fields id --format csv --noquotes | head -n 1 | tr -d '\r')
if [ -n "$wb_id" ]; then
  "$kcadm" update "clients/$wb_id" -r digital-employees \
    -s 'redirectUris=["http://127.0.0.1:19980/auth/callback","http://localhost:19980/auth/callback"]' \
    -s 'webOrigins=["http://127.0.0.1:19980","http://localhost:19980"]' >/dev/null
fi

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
