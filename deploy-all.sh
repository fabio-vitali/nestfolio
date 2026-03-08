#!/usr/bin/env bash
# deploy-all.sh — Phase-ordered deployment
set -euo pipefail
PREFIX=${1:?Usage: deploy-all.sh <prefix>}

echo "Phase 1: Hub stacks (EventBridge buses + SSM params)..."
pnpm nx run investor-hub:deploy --prefix=$PREFIX &
pnpm nx run advisory-hub:deploy --prefix=$PREFIX &
pnpm nx run execution-hub:deploy --prefix=$PREFIX &
wait

echo "Phase 2: Investor-web (Cognito triggers)..."
pnpm nx run investor-web:deploy --prefix=$PREFIX

echo "Phase 3: Controller services..."
pnpm nx run investor-ctrl:deploy --prefix=$PREFIX &
pnpm nx run advisory-ctrl:deploy --prefix=$PREFIX &
pnpm nx run compliance-ctrl:deploy --prefix=$PREFIX &
pnpm nx run execution-ctrl:deploy --prefix=$PREFIX &
pnpm nx run portfolio-ctrl:deploy --prefix=$PREFIX &
wait

echo "Phase 4: BFF services..."
pnpm nx run investor-bff:deploy --prefix=$PREFIX &
pnpm nx run advisory-bff:deploy --prefix=$PREFIX &
pnpm nx run portfolio-bff:deploy --prefix=$PREFIX &
pnpm nx run dashboard-bff:deploy --prefix=$PREFIX &
wait

echo "Phase 5: Adapter services..."
pnpm nx run execution-adpt:deploy --prefix=$PREFIX

echo "Phase 6: Re-deploy hubs (forwarding rules resolve after services exist)..."
pnpm nx run investor-hub:deploy --prefix=$PREFIX &
pnpm nx run advisory-hub:deploy --prefix=$PREFIX &
pnpm nx run execution-hub:deploy --prefix=$PREFIX &
wait

echo "Deployment complete for prefix: $PREFIX"
