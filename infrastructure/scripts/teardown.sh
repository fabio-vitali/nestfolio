#!/usr/bin/env bash
# teardown.sh — Dynamic reverse-order teardown driven by pipeline.json
set -euo pipefail

PREFIX=${1:?Usage: teardown.sh <prefix>}

APPROVAL_FLAG=""
if [ -n "${CI:-}" ]; then
  APPROVAL_FLAG="--force"
fi

trap 'echo "ERROR: Teardown failed. Prefix: $PREFIX — manual cleanup may be required." >&2' ERR

destroy_service() {
  local svc="$1"
  local region="${2:-$CDK_DEFAULT_REGION}"
  region="${region:-us-east-1}"
  echo "  Destroying $svc (${region})..."
  CDK_DEFAULT_REGION="$region" pnpm nx run "$svc:destroy" -- \
    --prefix="$PREFIX" $APPROVAL_FLAG \
    -c region="$region"
}

# Discover all services from pipeline.json files
PIPELINE_FILES=$(find services -maxdepth 3 -name "pipeline.json" -not -path "*/node_modules/*" -type f)

if [ -z "$PIPELINE_FILES" ]; then
  echo "ERROR: No pipeline.json files found." >&2
  exit 1
fi

# Teardown in reverse phase order (3, 2, 1)
TEARDOWN_FAIL=0
for PHASE in 3 2 1; do
  PARALLEL_SERVICES=""
  SERIAL_SERVICES=""

  for FILE in $PIPELINE_FILES; do
    FILE_PHASE=$(jq -r '.deploymentPhase' "$FILE")
    if [ "$FILE_PHASE" = "$PHASE" ]; then
      SVC=$(jq -r '.service' "$FILE")
      PARALLEL=$(jq -r '.production.parallelDeploy' "$FILE")
      REGIONS=$(jq -r '.production.regions[]' "$FILE")
      for REGION in $REGIONS; do
        ENTRY="${SVC}:${REGION}"
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
  echo "Phase $PHASE (teardown):$SERIAL_SERVICES$PARALLEL_SERVICES"

  # Destroy parallel services concurrently
  PIDS=""
  for ENTRY in $PARALLEL_SERVICES; do
    SVC="${ENTRY%%:*}"
    REGION="${ENTRY##*:}"
    destroy_service "$SVC" "$REGION" &
    PIDS="$PIDS $!"
  done
  FAIL=0
  for PID in $PIDS; do
    wait "$PID" || FAIL=1
  done
  if [ "$FAIL" -ne 0 ]; then
    echo "WARNING: One or more parallel teardowns failed in Phase $PHASE. Continuing..." >&2
    TEARDOWN_FAIL=1
  fi

  # Destroy serial services
  for ENTRY in $SERIAL_SERVICES; do
    SVC="${ENTRY%%:*}"
    REGION="${ENTRY##*:}"
    destroy_service "$SVC" "$REGION" || { echo "WARNING: Teardown of $SVC ($REGION) failed. Continuing..." >&2; TEARDOWN_FAIL=1; }
  done
done

echo ""
if [ "$TEARDOWN_FAIL" -ne 0 ]; then
  echo "Teardown completed with errors for prefix: $PREFIX — check logs above." >&2
  exit 1
else
  echo "Teardown complete for prefix: $PREFIX"
fi
