#!/usr/bin/env bash
# compute-affected-services.sh — Intersect NX affected projects with deployable services
# Usage: compute-affected-services.sh <base-sha>
# Output: comma-separated list of affected deployable service names (or empty string)
set -euo pipefail

BASE_SHA=${1:?Usage: compute-affected-services.sh <base-sha>}

# Get NX affected app projects (one per line)
AFFECTED=$(pnpm nx show projects --affected --base="$BASE_SHA" --type=app 2>/dev/null || true)

if [ -z "$AFFECTED" ]; then
  echo ""
  exit 0
fi

# Build set of deployable service names from pipeline.json files
DEPLOYABLE=""
while IFS= read -r -d '' FILE; do
  SVC=$(jq -r '.service' "$FILE")
  DEPLOYABLE="$DEPLOYABLE $SVC"
done < <(find services -maxdepth 3 -name "pipeline.json" -not -path "*/node_modules/*" -type f -print0)

# Intersect using grep: keep only affected projects that appear in deployable set
DEPLOYABLE_LIST=$(echo "$DEPLOYABLE" | tr ' ' '\n' | sed '/^$/d')
RESULT=$(echo "$AFFECTED" | grep -Fxf <(echo "$DEPLOYABLE_LIST") | paste -sd, - || true)

echo "$RESULT"
