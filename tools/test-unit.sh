#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
(cd "$root/platform/backend" && .venv/bin/pytest)
(cd "$root/platform/frontend" && npm test -- --run && npm run build)
(cd "$root/workbench" && npm test -- --run && npm run build)
