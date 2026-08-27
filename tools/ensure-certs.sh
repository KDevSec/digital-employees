#!/bin/sh
# 幂等生成本地 HTTPS 证书：
# - tools/certs/ca.{crt,key}   本地 CA（长期，重签叶证书时不变）
# - tools/certs/server.{crt,key} 服务器证书，SAN 覆盖 PUBLIC_HOST / localhost / 127.0.0.1
# 已有证书的 SAN 覆盖当前 PUBLIC_HOST 时直接复用；否则仅重签叶证书。
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tools_dir="$root/tools"
. "$tools_dir/runtime-env.sh"

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required to generate local HTTPS certificates." >&2
  exit 1
fi

cert_dir=${CERT_DIR:-"$tools_dir/certs"}
mkdir -p "$cert_dir"
ca_crt="$cert_dir/ca.crt"
ca_key="$cert_dir/ca.key"
server_crt="$cert_dir/server.crt"
server_key="$cert_dir/server.key"

# PUBLIC_HOST 已由 runtime-env.sh 校验为 IPv4 或 DNS 主机名。
case "$PUBLIC_HOST" in
  *[!0-9.]*) san_entry="DNS:$PUBLIC_HOST"; san_ext_entry="DNS:$PUBLIC_HOST" ;;
  *)         san_entry="IPAddress:$PUBLIC_HOST"; san_ext_entry="IP:$PUBLIC_HOST" ;;
esac
san_ext="DNS:localhost,IP:127.0.0.1,$san_ext_entry"

cert_covers_host() {
  [ -f "$server_crt" ] || return 1
  san_text=$(openssl x509 -in "$server_crt" -noout -ext subjectAltName 2>/dev/null | tr -d ' \n') || return 1
  san_flat=${san_text#*:}
  case ",$san_flat," in
    *",$san_entry,"*) return 0 ;;
    *) return 1 ;;
  esac
}

if [ -f "$ca_crt" ] && [ -f "$ca_key" ] && [ -f "$server_key" ] && cert_covers_host; then
  echo "Certificates already present in $cert_dir (SAN covers $PUBLIC_HOST); skipping generation."
  exit 0
fi

if [ ! -f "$ca_crt" ] || [ ! -f "$ca_key" ]; then
  echo "Generating local CA..."
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$ca_key" -out "$ca_crt" -days 3650 \
    -subj "/CN=Digital Employees Local CA" >/dev/null 2>&1
fi

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

echo "Generating server certificate for SAN: $san_ext"
openssl req -newkey rsa:2048 -nodes \
  -keyout "$server_key" -out "$tmp_dir/server.csr" \
  -subj "/CN=$PUBLIC_HOST" >/dev/null 2>&1
{
  printf 'subjectAltName=%s\n' "$san_ext"
  printf 'extendedKeyUsage=serverAuth\n'
} > "$tmp_dir/server-ext.cnf"
openssl x509 -req -in "$tmp_dir/server.csr" \
  -CA "$ca_crt" -CAkey "$ca_key" -CAcreateserial \
  -out "$server_crt" -days 825 \
  -extfile "$tmp_dir/server-ext.cnf" >/dev/null 2>&1
rm -f "$cert_dir/ca.srl"

chmod 644 "$ca_key" "$server_key" 2>/dev/null || true
echo "Certificates ready in $cert_dir (trust $ca_crt in browsers/clients as needed)."
