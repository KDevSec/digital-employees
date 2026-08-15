#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
"$root/tools/down.sh" --volumes
"$root/tools/up.sh"
(cd "$root/tools" && npm run test:e2e)
