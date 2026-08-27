#!/bin/sh
set -eu
attempt=0
until alembic upgrade head; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || exit 1
  sleep 2
done
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log --workers 4
