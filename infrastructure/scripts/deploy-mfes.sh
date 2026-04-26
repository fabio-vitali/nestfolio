#!/usr/bin/env bash
#
# deploy-mfes.sh — Run pnpm nx run <mfe>:deploy-mfe for every entry in
# MFE_CATALOG, in parallel. Fails fast if any one upload fails.
#
# Region scoping is per-iteration via env to avoid leaking
# CDK_DEFAULT_REGION across subprocesses.
#
# Usage:
#   deploy-mfes.sh <prefix> [region]

set -euo pipefail

PREFIX=${1:?Usage: deploy-mfes.sh <prefix> [region]}
REGION_ARG="${2:-}"
REGION="${REGION_ARG:-${CDK_DEFAULT_REGION:-us-east-1}}"

trap 'echo "ERROR: MFE batch deploy failed. Prefix: $PREFIX, Region: $REGION." >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CATALOG_SCRIPT="$REPO_ROOT/tools/scripts/list-mfe-catalog.mjs"

CATALOG_JSON=$(node "$CATALOG_SCRIPT")

PIDS=""
KEYS=""
while IFS= read -r entry; do
  KEY=$(echo "$entry" | jq -r '.key')
  echo "  Starting MFE deploy: $KEY"
  ( CDK_DEFAULT_REGION="$REGION" pnpm nx run "${KEY}-mfe:deploy-mfe" --prefix="$PREFIX" ) &
  PIDS="$PIDS $!"
  KEYS="$KEYS $KEY"
done < <(echo "$CATALOG_JSON" | jq -c '.[]')

FAIL=0
# shellcheck disable=SC2086
for PID in $PIDS; do
  wait "$PID" || FAIL=1
done

if [ "$FAIL" -ne 0 ]; then
  # shellcheck disable=SC2086
  echo "ERROR: One or more MFE deploys failed (keys:$KEYS)." >&2
  exit 1
fi

# shellcheck disable=SC2086
echo "All MFEs deployed (keys:$KEYS)."
