#!/bin/bash
# init-user-profile.sh - Configure Keycloak user profile with custom attributes
# Run after Keycloak realm import to ensure user attributes are returned by the Admin API

set -e

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:18080}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Horse~test@2026}"
REALM="${REALM:-digital-employees}"

echo "Waiting for Keycloak to be ready..."
for i in $(seq 1 30); do
    if curl -sf "${KEYCLOAK_URL}/realms/${REALM}/.well-known/openid-configuration" > /dev/null 2>&1; then
        echo "Keycloak is ready."
        break
    fi
    echo "  attempt $i/30..."
    sleep 3
done

echo "Getting admin token..."
TOKEN=$(curl -sf -X POST \
    "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
    -d "client_id=admin-cli" \
    -d "username=${ADMIN_USER}" \
    -d "password=${ADMIN_PASSWORD}" \
    -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "Fetching current user profile..."
CONFIG=$(curl -sf "${KEYCLOAK_URL}/admin/realms/${REALM}/users/profile" \
    -H "Authorization: Bearer ${TOKEN}")

# Check if custom attributes are already configured
if echo "$CONFIG" | python3 -c "import sys,json; d=json.load(sys.stdin); names=[a['name'] for a in d['attributes']]; print('domain_id' in names)"; then
    echo "Custom attributes already configured. Skipping."
    exit 0
fi

echo "Adding custom attributes to user profile..."
echo "$CONFIG" | python3 -c "
import sys, json
config = json.load(sys.stdin)
custom_attrs = [
    {'name': 'domain_id', 'displayName': 'Domain ID', 'multivalued': False, 'permissions': {'view': ['admin', 'user'], 'edit': ['admin']}},
    {'name': 'domain_name', 'displayName': 'Domain Name', 'multivalued': False, 'permissions': {'view': ['admin', 'user'], 'edit': ['admin']}},
    {'name': 'department_id', 'displayName': 'Department ID', 'multivalued': False, 'permissions': {'view': ['admin', 'user'], 'edit': ['admin']}},
    {'name': 'department_name', 'displayName': 'Department Name', 'multivalued': False, 'permissions': {'view': ['admin', 'user'], 'edit': ['admin']}},
    {'name': 'team_id', 'displayName': 'Team ID', 'multivalued': False, 'permissions': {'view': ['admin', 'user'], 'edit': ['admin']}},
    {'name': 'team_name', 'displayName': 'Team Name', 'multivalued': False, 'permissions': {'view': ['admin', 'user'], 'edit': ['admin']}},
    {'name': 'primary_org_id', 'displayName': 'Primary Org ID', 'multivalued': False, 'permissions': {'view': ['admin', 'user'], 'edit': ['admin']}},
]
config['attributes'].extend(custom_attrs)
print(json.dumps(config))
" > /tmp/up_config.json

curl -sf -X PUT "${KEYCLOAK_URL}/admin/realms/${REALM}/users/profile" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d @/tmp/up_config.json

echo ""
echo "User profile configured successfully."