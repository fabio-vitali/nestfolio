#!/usr/bin/env bash
# destroy-all.sh — Reverse-order teardown
set -euo pipefail
PREFIX=${1:?Usage: destroy-all.sh <prefix>}

# Destroy in reverse order
echo "Destroying hub stacks..."
npx nx run execution-hub:destroy --prefix=$PREFIX
npx nx run advisory-hub:destroy --prefix=$PREFIX
npx nx run investor-hub:destroy --prefix=$PREFIX

echo "Teardown complete for prefix: $PREFIX"
