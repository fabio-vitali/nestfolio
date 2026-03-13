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
  echo "  Destroying $svc..."
  pnpm nx run "$svc:destroy" -- --prefix="$PREFIX" $APPROVAL_FLAG
}

# Discover all services from pipeline.json files
PIPELINE_FILES=$(find services -maxdepth 3 -name "pipeline.json" -not -path "*/node_modules/*" -type f)

if [ -z "$PIPELINE_FILES" ]; then
  echo "ERROR: No pipeline.json files found." >&2
  exit 1
fi

# Teardown in reverse phase order (3, 2, 1)
for PHASE in 3 2 1; do
  PARALLEL_SERVICES=""
  SERIAL_SERVICES=""

  for FILE in $PIPELINE_FILES; do
    FILE_PHASE=$(jq -r '.deploymentPhase' "$FILE")
    if [ "$FILE_PHASE" = "$PHASE" ]; then
      SVC=$(jq -r '.service' "$FILE")
      PARALLEL=$(jq -r '.production.parallelDeploy' "$FILE")
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
  echo "Phase $PHASE (teardown):$SERIAL_SERVICES$PARALLEL_SERVICES"

  # Destroy parallel services concurrently
  for SVC in $PARALLEL_SERVICES; do
    destroy_service "$SVC" &
  done
  wait

  # Destroy serial services
  for SVC in $SERIAL_SERVICES; do
    destroy_service "$SVC"
  done
done

echo ""
echo "Teardown complete for prefix: $PREFIX"
