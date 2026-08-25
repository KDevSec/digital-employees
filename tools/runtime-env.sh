#!/bin/sh

: "${tools_dir:?tools_dir must be set before sourcing runtime-env.sh}"

# Ensure default .env exists (create from example on first run)
default_env="$tools_dir/.env"
if [ ! -f "$default_env" ]; then
  echo "Creating tools/.env from .env.example (please review and customize)" >&2
  cp "$tools_dir/.env.example" "$default_env"
fi

if [ -z "${PUBLIC_HOST:-}" ]; then
  runtime_env_file=${RUNTIME_ENV_FILE:-"$default_env"}
  if [ -f "$runtime_env_file" ]; then
    # Read only PUBLIC_HOST; never execute local configuration as shell code.
    PUBLIC_HOST=$(sed -n 's/^[[:space:]]*PUBLIC_HOST[[:space:]]*=[[:space:]]*//p' "$runtime_env_file" | tail -n 1)
  fi
fi

PUBLIC_HOST=${PUBLIC_HOST:-127.0.0.1}
case "$PUBLIC_HOST" in
  -*|.*|*.|*..*|*[!A-Za-z0-9.-]*)
    echo "PUBLIC_HOST must be an IPv4 address or DNS hostname without scheme or port" >&2
    return 2 2>/dev/null || exit 2
    ;;
esac
export PUBLIC_HOST
