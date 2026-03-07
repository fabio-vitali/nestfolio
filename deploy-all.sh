#!/usr/bin/env bash
# deploy-all.sh — Phase-ordered deployment
set -euo pipefail
PREFIX=${1:?Usage: deploy-all.sh <prefix>}

echo "Phase 1: Hub stacks..."
npx nx run investor-hub:deploy --prefix=$PREFIX
npx nx run advisory-hub:deploy --prefix=$PREFIX
npx nx run execution-hub:deploy --prefix=$PREFIX

echo "Phase 1 (pass 2): Re-deploy hubs with forwarding rules..."
npx nx run investor-hub:deploy --prefix=$PREFIX
npx nx run advisory-hub:deploy --prefix=$PREFIX
npx nx run execution-hub:deploy --prefix=$PREFIX

# Phase 2-4 services added in later steps
echo "Deployment complete for prefix: $PREFIX"
