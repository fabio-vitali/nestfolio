#!/usr/bin/env bash
# deploy-all.sh — Dynamic phase-ordered deployment driven by pipeline.json
set -euo pipefail

PREFIX=${1:?Usage: deploy-all.sh <prefix> [--no-observability]}

# Parse optional flags
OBSERVABILITY="true"
shift
for arg in "$@"; do
  case "$arg" in
    --no-observability) OBSERVABILITY="false" ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# Determine approval mode: skip approval in CI, require locally
APPROVAL_FLAG=""
if [ -n "${CI:-}" ]; then
  APPROVAL_FLAG="--require-approval never"
fi

trap 'echo "ERROR: Deployment failed. Prefix: $PREFIX — manual cleanup may be required." >&2' ERR

verify_ssm_param() {
  local param_name="$1"
  if ! aws ssm get-parameter --name "$param_name" --query 'Parameter.Value' --output text > /dev/null 2>&1; then
    echo "ERROR: SSM parameter $param_name not found after deployment." >&2
    exit 1
  fi
}

deploy_service() {
  local svc="$1"
  echo "  Deploying $svc..."
  pnpm nx run "$svc:deploy" -- --prefix="$PREFIX" $APPROVAL_FLAG -c observability="$OBSERVABILITY"
}

# Discover all services from pipeline.json files
PIPELINE_FILES=$(find services -maxdepth 3 -name "pipeline.json" -not -path "*/node_modules/*" -type f)

if [ -z "$PIPELINE_FILES" ]; then
  echo "ERROR: No pipeline.json files found." >&2
  exit 1
fi

echo "Observability: $OBSERVABILITY"

# Collect hub services for re-deploy phase
HUB_SERVICES=""

# Deploy by phase (1, 2, 3)
for PHASE in 1 2 3; do
  PARALLEL_SERVICES=""
  SERIAL_SERVICES=""

  for FILE in $PIPELINE_FILES; do
    FILE_PHASE=$(jq -r '.deploymentPhase' "$FILE")
    if [ "$FILE_PHASE" = "$PHASE" ]; then
      SVC=$(jq -r '.service' "$FILE")
      PARALLEL=$(jq -r '.production.parallelDeploy' "$FILE")

      if [ "$PHASE" = "1" ]; then
        HUB_SERVICES="$HUB_SERVICES $SVC"
      fi

      if [ "$PARALLEL" = "true" ]; then
        PARALLEL_SERVICES="$PARALLEL_SERVICES $SVC"
      else
        SERIAL_SERVICES="$SERIAL_SERVICES $SVC"
      fi
    fi
  done

  if [ -z "$PARALLEL_SERVICES$SERIAL_SERVICES" ]; then
    continue
  fi

  echo ""
  echo "Phase $PHASE:$SERIAL_SERVICES$PARALLEL_SERVICES"

  # Deploy serial services first
  for SVC in $SERIAL_SERVICES; do
    deploy_service "$SVC"
  done

  # Deploy parallel services concurrently
  PIDS=""
  for SVC in $PARALLEL_SERVICES; do
    deploy_service "$SVC" &
    PIDS="$PIDS $!"
  done
  FAIL=0
  for PID in $PIDS; do
    wait "$PID" || FAIL=1
  done
  if [ "$FAIL" -ne 0 ]; then echo "ERROR: One or more parallel deploys failed in Phase $PHASE." >&2; exit 1; fi

  # Post-phase verification
  if [ "$PHASE" = "1" ]; then
    echo "Verifying Phase 1 SSM parameters..."
    for FILE in $PIPELINE_FILES; do
      FILE_PHASE=$(jq -r '.deploymentPhase' "$FILE")
      if [ "$FILE_PHASE" = "1" ]; then
        SUBSYSTEM=$(jq -r '.subsystem' "$FILE")
        verify_ssm_param "/nestfolio/${PREFIX}-${SUBSYSTEM}/event-hub/busArn"
      fi
    done
  fi

  if [ "$PHASE" = "2" ]; then
    echo "Verifying Phase 2 SSM parameters..."
    verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolId"
    verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolClientId"
  fi
done

# Re-deploy hubs so cross-domain forwarding rules resolve
if [ -n "$HUB_SERVICES" ]; then
  echo ""
  echo "Phase 4 (hub re-deploy):$HUB_SERVICES"
  PIDS=""
  for SVC in $HUB_SERVICES; do
    deploy_service "$SVC" &
    PIDS="$PIDS $!"
  done
  FAIL=0
  for PID in $PIDS; do
    wait "$PID" || FAIL=1
  done
  if [ "$FAIL" -ne 0 ]; then echo "ERROR: One or more hub re-deploys failed." >&2; exit 1; fi
fi

echo ""
echo "Deployment complete for prefix: $PREFIX"
