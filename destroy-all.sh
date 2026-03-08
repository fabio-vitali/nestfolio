#!/usr/bin/env bash
# destroy-all.sh — Reverse-order teardown (mirrors deploy-all.sh phases in reverse)
set -euo pipefail
PREFIX=${1:?Usage: destroy-all.sh <prefix>}

echo "Phase 1: Adapter services..."
pnpm nx run execution-adpt:destroy --prefix=$PREFIX

echo "Phase 2: BFF services..."
pnpm nx run investor-bff:destroy --prefix=$PREFIX &
pnpm nx run advisory-bff:destroy --prefix=$PREFIX &
pnpm nx run portfolio-bff:destroy --prefix=$PREFIX &
pnpm nx run dashboard-bff:destroy --prefix=$PREFIX &
wait

echo "Phase 3: Controller services..."
pnpm nx run investor-ctrl:destroy --prefix=$PREFIX &
pnpm nx run advisory-ctrl:destroy --prefix=$PREFIX &
pnpm nx run compliance-ctrl:destroy --prefix=$PREFIX &
pnpm nx run execution-ctrl:destroy --prefix=$PREFIX &
pnpm nx run portfolio-ctrl:destroy --prefix=$PREFIX &
wait

echo "Phase 4: Investor-web (Cognito triggers)..."
pnpm nx run investor-web:destroy --prefix=$PREFIX

echo "Phase 5: Hub stacks (EventBridge buses + SSM params)..."
pnpm nx run execution-hub:destroy --prefix=$PREFIX &
pnpm nx run advisory-hub:destroy --prefix=$PREFIX &
pnpm nx run investor-hub:destroy --prefix=$PREFIX &
wait

echo "Teardown complete for prefix: $PREFIX"
