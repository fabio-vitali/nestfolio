#!/usr/bin/env bash
# compute-affected-services.sh — Intersect NX affected projects with deployable services
# Usage: compute-affected-services.sh <base-sha>
# Output: comma-separated list of affected deployable service names (or empty string)
set -euo pipefail

BASE_SHA=${1:?Usage: compute-affected-services.sh <base-sha>}

# Get NX affected app projects
AFFECTED=$(pnpm nx show projects --affected --base="$BASE_SHA" --type=app 2>/dev/null || true)

if [ -z "$AFFECTED" ]; then
  echo ""
  exit 0
fi

# Build set of deployable service names from pipeline.json files
DEPLOYABLE=""
for FILE in $(find services -maxdepth 3 -name "pipeline.json" -not -path "*/node_modules/*" -type f); do
  SVC=$(jq -r '.service' "$FILE")
  DEPLOYABLE="$DEPLOYABLE $SVC"
done

# Intersect: only services that are both NX-affected AND have a pipeline.json
RESULT=""
for PROJECT in $AFFECTED; do
  for SVC in $DEPLOYABLE; do
    if [ "$PROJECT" = "$SVC" ]; then
      if [ -n "$RESULT" ]; then
        RESULT="$RESULT,$SVC"
      else
        RESULT="$SVC"
      fi
      break
    fi
  done
done

echo "$RESULT"
