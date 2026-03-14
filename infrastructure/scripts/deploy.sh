#!/usr/bin/env bash
# deploy.sh — Phase-ordered deployment driven by resolve-all-configs.ts
set -euo pipefail

TIER=${1:?Usage: deploy.sh <tier> [--prefix=<custom>] [--services=svc1,svc2,...] [--dry-run]}

# Validate tier
case "$TIER" in
  sandbox|staging|prod|production) ;;
  *) echo "ERROR: Invalid tier '$TIER'. Must be sandbox, staging, prod, or production." >&2; exit 1 ;;
esac

# Normalize tier for resolver
RESOLVER_TIER="$TIER"
if [ "$TIER" = "prod" ]; then RESOLVER_TIER="production"; fi

# Parse optional flags
PREFIX=""
SERVICES_FILTER=""
SERVICES_FLAG_PROVIDED="false"
DRY_RUN="false"
shift
for arg in "$@"; do
  case "$arg" in
    --prefix=*) PREFIX="${arg#--prefix=}" ;;
    --services=*) SERVICES_FILTER="${arg#--services=}"; SERVICES_FLAG_PROVIDED="true" ;;
    --dry-run) DRY_RUN="true" ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# Default prefix from tier
if [ -z "$PREFIX" ]; then
  case "$TIER" in
    sandbox) PREFIX="sandbox" ;;
    staging) PREFIX="staging" ;;
    prod|production) PREFIX="prod" ;;
  esac
fi

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

trap 'echo "ERROR: Deployment failed. Tier: $TIER, Prefix: $PREFIX — manual cleanup may be required." >&2' ERR

# ── Resolve all configs ─────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

RESOLVER_ARGS="$RESOLVER_TIER --prefix=$PREFIX"
CONFIGS=$(node --no-warnings "$SCRIPT_DIR/resolve-all-configs.ts" $RESOLVER_ARGS)

# ── Helper functions ────────────────────────────────────────────────────────

is_service_included() {
  local svc="$1"
  if [ "$SERVICES_FLAG_PROVIDED" = "false" ]; then return 0; fi
  echo ",$SERVICES_FILTER," | grep -q ",$svc,"
}

deploy_service() {
  local svc="$1"
  local region="${2:-}"
  local account="${3:-}"
  local config_json="$4"

  # Extract config values
  local observability=$(echo "$config_json" | jq -r '.observability')
  local log_retention=$(echo "$config_json" | jq -r '.logRetention')
  local protected_resources=$(echo "$config_json" | jq -r '.protectedResources')

  local region_flag="${region:-${CDK_DEFAULT_REGION:-us-east-1}}"

  echo "  Deploying $svc (${region_flag})..."

  if [ "$DRY_RUN" = "true" ]; then
    echo "    [DRY RUN] Would deploy with: tier=$TIER prefix=$PREFIX observability=$observability logRetention=$log_retention protectedResources=$protected_resources"
    return 0
  fi

  local env_vars=""
  if [ -n "$region" ]; then env_vars="CDK_DEFAULT_REGION=$region"; fi
  if [ -n "$account" ]; then env_vars="$env_vars CDK_DEFAULT_ACCOUNT=$account"; fi

  env $env_vars pnpm nx run "$svc:deploy" -- \
    $APPROVAL_FLAG \
    -c prefix="$PREFIX" \
    -c tier="$RESOLVER_TIER" \
    -c observability="$observability" \
    -c logRetention="$log_retention" \
    -c protectedResources="$protected_resources" \
    -c region="$region_flag"
}

verify_ssm_param() {
  local param_name="$1"
  local region="${2:-${CDK_DEFAULT_REGION:-us-east-1}}"
  if [ "$DRY_RUN" = "true" ]; then
    echo "    [DRY RUN] Would verify SSM: $param_name ($region)"
    return 0
  fi
  if ! aws ssm get-parameter --name "$param_name" --region "$region" --query 'Parameter.Value' --output text > /dev/null 2>&1; then
    echo "ERROR: SSM parameter $param_name not found in $region after deployment." >&2
    exit 1
  fi
}

check_all_hub_params_exist() {
  if [ "$DRY_RUN" = "true" ]; then return 1; fi
  local hub_configs="$1"
  for cfg in $(echo "$hub_configs" | jq -c '.[]'); do
    local subsystem=$(echo "$cfg" | jq -r '.subsystem')
    local region=$(echo "$cfg" | jq -r '.region // empty')
    region="${region:-${CDK_DEFAULT_REGION:-us-east-1}}"
    local param="/nestfolio/${PREFIX}-${subsystem}/event-hub/busArn"
    if ! aws ssm get-parameter --name "$param" --region "$region" --query 'Parameter.Value' --output text > /dev/null 2>&1; then
      return 1
    fi
  done
  return 0
}

# ── Deployment ──────────────────────────────────────────────────────────────

echo "Tier: $TIER"
echo "Prefix: $PREFIX"
if [ "$SERVICES_FLAG_PROVIDED" = "true" ]; then
  echo "Service filter: $SERVICES_FILTER"
else
  echo "Service filter: (all)"
fi
if [ "$DRY_RUN" = "true" ]; then echo "Mode: DRY RUN"; fi

# Collect hub configs for Phase 4
HUB_CONFIGS="[]"

# Get unique targets (for multi-target production)
TARGETS=$(echo "$CONFIGS" | jq -c '[.[] | {account: (.account // ""), region: (.region // ""), environment: (.environment // "")}] | unique')
TARGET_COUNT=$(echo "$TARGETS" | jq 'length')

# Deploy phases per target
for TARGET_IDX in $(seq 0 $((TARGET_COUNT - 1))); do
  TARGET=$(echo "$TARGETS" | jq -c ".[$TARGET_IDX]")
  TARGET_ACCOUNT=$(echo "$TARGET" | jq -r '.account // empty')
  TARGET_REGION=$(echo "$TARGET" | jq -r '.region // empty')
  TARGET_ENV=$(echo "$TARGET" | jq -r '.environment // empty')

  if [ "$TARGET_COUNT" -gt 1 ]; then
    echo ""
    echo "═══ Target: ${TARGET_ENV:-default} (${TARGET_REGION:-default}) ═══"
  fi

  for PHASE in 1 2 3; do
    # Filter configs for this phase + target
    PHASE_CONFIGS=$(echo "$CONFIGS" | jq -c "[.[] | select(
      .deploymentPhase == $PHASE and
      ((.account // \"\") == \"$TARGET_ACCOUNT\") and
      ((.region // \"\") == \"$TARGET_REGION\")
    )]")

    PHASE_COUNT=$(echo "$PHASE_CONFIGS" | jq 'length')
    if [ "$PHASE_COUNT" = "0" ]; then continue; fi

    echo ""
    echo "Phase $PHASE:"

    # Collect hub configs for Phase 4
    if [ "$PHASE" = "1" ]; then
      HUB_CONFIGS=$(echo "$PHASE_CONFIGS" | jq -c "[.[] | select(.service | endswith(\"-hub\"))]")
    fi

    # Split into serial and parallel
    SERIAL_CONFIGS=$(echo "$PHASE_CONFIGS" | jq -c '[.[] | select(.parallelDeploy == false)]')
    PARALLEL_CONFIGS=$(echo "$PHASE_CONFIGS" | jq -c '[.[] | select(.parallelDeploy == true)]')

    # Deploy serial services first
    for cfg in $(echo "$SERIAL_CONFIGS" | jq -c '.[]'); do
      SVC=$(echo "$cfg" | jq -r '.service')
      if is_service_included "$SVC"; then
        deploy_service "$SVC" "$TARGET_REGION" "$TARGET_ACCOUNT" "$cfg"
      fi
    done

    # Deploy parallel services concurrently
    PIDS=""
    for cfg in $(echo "$PARALLEL_CONFIGS" | jq -c '.[]'); do
      SVC=$(echo "$cfg" | jq -r '.service')
      if is_service_included "$SVC"; then
        deploy_service "$SVC" "$TARGET_REGION" "$TARGET_ACCOUNT" "$cfg" &
        PIDS="$PIDS $!"
      fi
    done
    FAIL=0
    for PID in $PIDS; do
      wait "$PID" || FAIL=1
    done
    if [ "$FAIL" -ne 0 ]; then echo "ERROR: One or more parallel deploys failed in Phase $PHASE." >&2; exit 1; fi

    # Post-phase verification
    if [ "$PHASE" = "1" ]; then
      echo "Verifying Phase 1 SSM parameters..."
      for cfg in $(echo "$PHASE_CONFIGS" | jq -c '.[]'); do
        SVC=$(echo "$cfg" | jq -r '.service')
        if is_service_included "$SVC"; then
          SUBSYSTEM=$(echo "$cfg" | jq -r '.subsystem')
          REGION=$(echo "$cfg" | jq -r '.region // empty')
          verify_ssm_param "/nestfolio/${PREFIX}-${SUBSYSTEM}/event-hub/busArn" "${REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
        fi
      done
    fi

    if [ "$PHASE" = "2" ]; then
      echo "Verifying Phase 2 SSM parameters..."
      verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolId" "${TARGET_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
      verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolClientId" "${TARGET_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
    fi
  done

  # Phase 4: Re-deploy hubs (only on first deploy)
  HUB_COUNT=$(echo "$HUB_CONFIGS" | jq 'length')
  if [ "$HUB_COUNT" -gt 0 ]; then
    if check_all_hub_params_exist "$HUB_CONFIGS"; then
      echo ""
      echo "Phase 4 (hub re-deploy): SKIPPED — all hub SSM parameters already exist."
    else
      echo ""
      echo "Phase 4 (hub re-deploy — first deploy detected):"
      PIDS=""
      for cfg in $(echo "$HUB_CONFIGS" | jq -c '.[]'); do
        SVC=$(echo "$cfg" | jq -r '.service')
        if is_service_included "$SVC"; then
          deploy_service "$SVC" "$TARGET_REGION" "$TARGET_ACCOUNT" "$cfg" &
          PIDS="$PIDS $!"
        fi
      done
      FAIL=0
      for PID in $PIDS; do
        wait "$PID" || FAIL=1
      done
      if [ "$FAIL" -ne 0 ]; then echo "ERROR: One or more hub re-deploys failed." >&2; exit 1; fi
    fi
  fi
done

echo ""
echo "Deployment complete. Tier: $TIER, Prefix: $PREFIX"
