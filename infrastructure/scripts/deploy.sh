#!/usr/bin/env bash
# deploy.sh — Dynamic phase-ordered deployment driven by pipeline.json
set -euo pipefail

PREFIX=${1:?Usage: deploy.sh <prefix> [--no-observability] [--services=svc1,svc2,...]}

# Parse optional flags
OBSERVABILITY="true"
SERVICES_FILTER=""
SERVICES_FLAG_PROVIDED="false"
shift
for arg in "$@"; do
  case "$arg" in
    --no-observability) OBSERVABILITY="false" ;;
    --services=*) SERVICES_FILTER="${arg#--services=}"; SERVICES_FLAG_PROVIDED="true" ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# If --services was passed with an empty value, skip deployment
if [ "$SERVICES_FLAG_PROVIDED" = "true" ] && [ -z "$SERVICES_FILTER" ]; then
  echo "No affected services — skipping deployment."
  exit 0
fi

# Determine approval mode: skip approval in CI, require locally
APPROVAL_FLAG=""
if [ -n "${CI:-}" ]; then
  APPROVAL_FLAG="--require-approval never"
fi

trap 'echo "ERROR: Deployment failed. Prefix: $PREFIX — manual cleanup may be required." >&2' ERR

deploy_service() {
  local svc="$1"
  local region="${2:-$CDK_DEFAULT_REGION}"
  region="${region:-us-east-1}"
  echo "  Deploying $svc (${region})..."
  CDK_DEFAULT_REGION="$region" pnpm nx run "$svc:deploy" -- \
    --prefix="$PREFIX" $APPROVAL_FLAG \
    -c observability="$OBSERVABILITY" \
    -c region="$region"
}

verify_ssm_param() {
  local param_name="$1"
  local region="${2:-$CDK_DEFAULT_REGION}"
  region="${region:-us-east-1}"
  if ! aws ssm get-parameter --name "$param_name" --region "$region" --query 'Parameter.Value' --output text > /dev/null 2>&1; then
    echo "ERROR: SSM parameter $param_name not found in $region after deployment." >&2
    exit 1
  fi
}

# Returns 0 if ALL hub bus-ARN SSM parameters exist (in all regions), 1 otherwise.
# Used to gate Phase 4 — the re-deploy is only needed on first deploy.
check_all_hub_params_exist() {
  local entries="$1"
  for ENTRY in $entries; do
    local svc="${ENTRY%%:*}"
    local region="${ENTRY##*:}"
    # Find the subsystem for this service from pipeline.json
    for FILE in $PIPELINE_FILES; do
      if [ "$(jq -r '.service' "$FILE")" = "$svc" ]; then
        local subsystem=$(jq -r '.subsystem' "$FILE")
        local param="/nestfolio/${PREFIX}-${subsystem}/event-hub/busArn"
        if ! aws ssm get-parameter --name "$param" --region "$region" --query 'Parameter.Value' --output text > /dev/null 2>&1; then
          return 1
        fi
        break
      fi
    done
  done
  return 0
}

is_service_included() {
  local svc="$1"
  # No filter = include everything
  if [ "$SERVICES_FLAG_PROVIDED" = "false" ]; then
    return 0
  fi
  # Check if service is in comma-separated list
  echo ",$SERVICES_FILTER," | grep -q ",$svc,"
}

# Discover all services from pipeline.json files
PIPELINE_FILES=$(find services -maxdepth 3 -name "pipeline.json" -not -path "*/node_modules/*" -type f)

if [ -z "$PIPELINE_FILES" ]; then
  echo "ERROR: No pipeline.json files found." >&2
  exit 1
fi

echo "Observability: $OBSERVABILITY"
if [ "$SERVICES_FLAG_PROVIDED" = "true" ]; then
  echo "Service filter: $SERVICES_FILTER"
else
  echo "Service filter: (all)"
fi

# Collect hub entries (svc:region pairs) for re-deploy phase
HUB_ENTRIES=""

# Deploy by phase (1, 2, 3)
for PHASE in 1 2 3; do
  PARALLEL_SERVICES=""
  SERIAL_SERVICES=""

  for FILE in $PIPELINE_FILES; do
    FILE_PHASE=$(jq -r '.deploymentPhase' "$FILE")
    if [ "$FILE_PHASE" = "$PHASE" ]; then
      SVC=$(jq -r '.service' "$FILE")

      # Skip if not in affected filter
      if ! is_service_included "$SVC"; then
        continue
      fi

      PARALLEL=$(jq -r '.production.parallelDeploy' "$FILE")
      REGIONS=$(jq -r '.production.regions[]' "$FILE")

      for REGION in $REGIONS; do
        ENTRY="${SVC}:${REGION}"

        if [ "$PHASE" = "1" ]; then
          HUB_ENTRIES="$HUB_ENTRIES $ENTRY"
        fi

        if [ "$PARALLEL" = "true" ]; then
          PARALLEL_SERVICES="$PARALLEL_SERVICES $ENTRY"
        else
          SERIAL_SERVICES="$SERIAL_SERVICES $ENTRY"
        fi
      done
    fi
  done

  if [ -z "$PARALLEL_SERVICES$SERIAL_SERVICES" ]; then
    continue
  fi

  echo ""
  echo "Phase $PHASE:$SERIAL_SERVICES$PARALLEL_SERVICES"

  # Deploy serial services first
  for ENTRY in $SERIAL_SERVICES; do
    SVC="${ENTRY%%:*}"
    REGION="${ENTRY##*:}"
    deploy_service "$SVC" "$REGION"
  done

  # Deploy parallel services concurrently
  PIDS=""
  for ENTRY in $PARALLEL_SERVICES; do
    SVC="${ENTRY%%:*}"
    REGION="${ENTRY##*:}"
    deploy_service "$SVC" "$REGION" &
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
        SVC=$(jq -r '.service' "$FILE")
        if is_service_included "$SVC"; then
          REGIONS=$(jq -r '.production.regions[]' "$FILE")
          for REGION in $REGIONS; do
            verify_ssm_param "/nestfolio/${PREFIX}-${SUBSYSTEM}/event-hub/busArn" "$REGION"
          done
        fi
      fi
    done
  fi

  if [ "$PHASE" = "2" ]; then
    echo "Verifying Phase 2 SSM parameters..."
    verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolId"
    verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolClientId"
  fi
done

# Phase 4: Re-deploy hubs (only needed on first deploy when SSM params didn't exist yet)
if [ -n "$HUB_ENTRIES" ]; then
  if check_all_hub_params_exist "$HUB_ENTRIES"; then
    echo ""
    echo "Phase 4 (hub re-deploy): SKIPPED — all hub SSM parameters already exist."
  else
    echo ""
    echo "Phase 4 (hub re-deploy — first deploy detected):$HUB_ENTRIES"
    PIDS=""
    for ENTRY in $HUB_ENTRIES; do
      SVC="${ENTRY%%:*}"
      REGION="${ENTRY##*:}"
      deploy_service "$SVC" "$REGION" &
      PIDS="$PIDS $!"
    done
    FAIL=0
    for PID in $PIDS; do
      wait "$PID" || FAIL=1
    done
    if [ "$FAIL" -ne 0 ]; then echo "ERROR: One or more hub re-deploys failed." >&2; exit 1; fi
  fi
fi

echo ""
echo "Deployment complete for prefix: $PREFIX"
