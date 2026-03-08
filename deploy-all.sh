#!/usr/bin/env bash
# deploy-all.sh — Phase-ordered deployment
set -euo pipefail

PREFIX=${1:?Usage: deploy-all.sh <prefix>}

# Determine approval mode: skip approval in CI, require locally
APPROVAL_FLAG=""
if [ -n "${CI:-}" ]; then
  APPROVAL_FLAG="--require-approval never"
fi

# Trap for phase failure
cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    echo "ERROR: Deployment failed at phase. Exit code: $exit_code"
    echo "Prefix: $PREFIX — manual cleanup may be required."
  fi
  exit $exit_code
}
trap cleanup EXIT

verify_ssm_param() {
  local param_name="$1"
  if ! aws ssm get-parameter --name "$param_name" --query 'Parameter.Value' --output text > /dev/null 2>&1; then
    echo "ERROR: SSM parameter $param_name not found after deployment."
    exit 1
  fi
}

echo "Phase 1: Hub stacks (EventBridge buses + SSM params)..."
pnpm nx run investor-hub:deploy --prefix=$PREFIX $APPROVAL_FLAG &
pnpm nx run advisory-hub:deploy --prefix=$PREFIX $APPROVAL_FLAG &
pnpm nx run execution-hub:deploy --prefix=$PREFIX $APPROVAL_FLAG &
wait

echo "Verifying Phase 1 SSM parameters..."
verify_ssm_param "/nestfolio/${PREFIX}-investor/event-hub/busArn"
verify_ssm_param "/nestfolio/${PREFIX}-advisory/event-hub/busArn"
verify_ssm_param "/nestfolio/${PREFIX}-execution/event-hub/busArn"

echo "Phase 2: Investor-web (Cognito triggers)..."
pnpm nx run investor-web:deploy --prefix=$PREFIX $APPROVAL_FLAG

echo "Verifying Phase 2 SSM parameters..."
verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolId"
verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolClientId"

echo "Phase 3: Controller services..."
pnpm nx run investor-ctrl:deploy --prefix=$PREFIX $APPROVAL_FLAG &
pnpm nx run advisory-ctrl:deploy --prefix=$PREFIX $APPROVAL_FLAG &
pnpm nx run compliance-ctrl:deploy --prefix=$PREFIX $APPROVAL_FLAG &
pnpm nx run execution-ctrl:deploy --prefix=$PREFIX $APPROVAL_FLAG &
pnpm nx run portfolio-ctrl:deploy --prefix=$PREFIX $APPROVAL_FLAG &
wait

echo "Phase 4: BFF services..."
pnpm nx run investor-bff:deploy --prefix=$PREFIX $APPROVAL_FLAG &
pnpm nx run advisory-bff:deploy --prefix=$PREFIX $APPROVAL_FLAG &
pnpm nx run portfolio-bff:deploy --prefix=$PREFIX $APPROVAL_FLAG &
pnpm nx run dashboard-bff:deploy --prefix=$PREFIX $APPROVAL_FLAG &
wait

echo "Phase 5: Adapter services..."
pnpm nx run execution-adpt:deploy --prefix=$PREFIX $APPROVAL_FLAG

echo "Phase 6: Re-deploy hubs (forwarding rules resolve after services exist)..."
pnpm nx run investor-hub:deploy --prefix=$PREFIX $APPROVAL_FLAG &
pnpm nx run advisory-hub:deploy --prefix=$PREFIX $APPROVAL_FLAG &
pnpm nx run execution-hub:deploy --prefix=$PREFIX $APPROVAL_FLAG &
wait

echo "Deployment complete for prefix: $PREFIX"
