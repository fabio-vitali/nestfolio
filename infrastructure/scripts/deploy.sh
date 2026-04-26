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

# ── Build agent bundles ────────────────────────────────────────────────────
echo "Building agent bundles..."
if [ "$DRY_RUN" = "true" ]; then
  echo "  [DRY RUN] Would run: pnpm nx run-many -t build-agent --projects=tag:has-agent-runtime"
else
  pnpm nx run-many -t build-agent --projects=tag:has-agent-runtime --parallel=5 || {
    echo "ERROR: Agent bundle build failed." >&2
    exit 1
  }
fi

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
  shift 4  # remaining args become extra -c flags appended to cdk deploy

  # Extract config values
  local subsystem=$(echo "$config_json" | jq -r '.subsystem')
  local observability=$(echo "$config_json" | jq -r '.observability')
  local log_retention=$(echo "$config_json" | jq -r '.logRetention')
  local protected_resources=$(echo "$config_json" | jq -r '.protectedResources')

  local region_flag="${region:-${CDK_DEFAULT_REGION:-us-east-1}}"

  echo "  Deploying $svc (${region_flag})..."

  if [ "$DRY_RUN" = "true" ]; then
    echo "    [DRY RUN] Would deploy with: tier=$TIER prefix=$PREFIX observability=$observability logRetention=$log_retention protectedResources=$protected_resources${*:+ extra: $*}"
    return 0
  fi

  local env_vars=""
  if [ -n "$region" ]; then env_vars="CDK_DEFAULT_REGION=$region"; fi
  if [ -n "$account" ]; then env_vars="$env_vars CDK_DEFAULT_ACCOUNT=$account"; fi

  # Run CDK directly with per-service output dir to avoid cdk.out conflicts in parallel deploys
  local app_path="services/$subsystem/$svc/src/main.ts"
  env $env_vars npx cdk deploy \
    --app "npx ts-node -r ./tools/register-paths.js $app_path" \
    --require-approval never \
    --output "cdk.out.$svc" \
    -c prefix="$PREFIX" \
    -c tier="$RESOLVER_TIER" \
    -c observability="$observability" \
    -c logRetention="$log_retention" \
    -c protectedResources="$protected_resources" \
    -c region="$region_flag" \
    "$@"
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
  while IFS= read -r cfg; do
    local subsystem=$(echo "$cfg" | jq -r '.subsystem')
    local region=$(echo "$cfg" | jq -r '.region // empty')
    region="${region:-${CDK_DEFAULT_REGION:-us-east-1}}"
    local param="/nestfolio/${PREFIX}-${subsystem}/event-hub/busArn"
    if ! aws ssm get-parameter --name "$param" --region "$region" --query 'Parameter.Value' --output text > /dev/null 2>&1; then
      return 1
    fi
  done < <(echo "$hub_configs" | jq -c '.[]')
  return 0
}

check_all_mfe_params_exist() {
  if [ "$DRY_RUN" = "true" ]; then return 1; fi
  local region="${TARGET_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
  local catalog
  catalog=$(node "$REPO_ROOT/tools/scripts/list-mfe-catalog.mjs") || return 1
  while IFS= read -r entry; do
    local svc has_facade
    svc=$(echo "$entry" | jq -r '.service')
    has_facade=$(echo "$entry" | jq -r '.hasFacade')
    aws ssm get-parameter --name "/nestfolio/${PREFIX}-${svc}/mfe/bucketName" \
      --region "$region" --query 'Parameter.Value' --output text >/dev/null 2>&1 || return 1
    if [ "$has_facade" = "true" ]; then
      aws ssm get-parameter --name "/nestfolio/${PREFIX}-${svc}/api/apiId" \
        --region "$region" --query 'Parameter.Value' --output text >/dev/null 2>&1 || return 1
    fi
  done < <(echo "$catalog" | jq -c '.[]')
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

  # Reset MFE cold-start flags for this target — Phase 2 will set them based
  # on this target's SSM state. Without the reset, target N could inherit
  # target N-1's state when target N has no Phase 2 deploys (e.g., --services
  # filter).
  MFE_BOOTSTRAP_NEEDED=false
  MFE_BEHAVIORS_PHASE2=true

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

    # Capture MFE readiness ONCE before this phase's deploys, since BFF
    # exports get published during Phase 3 itself. On a cold start we deploy
    # investor-web in Phase 2 with mfeBehaviors=false, then Phase 4a re-runs
    # it with mfeBehaviors=true after Phase 3 publishes the SSM exports.
    if [ "$PHASE" = "2" ]; then
      if check_all_mfe_params_exist; then
        MFE_BOOTSTRAP_NEEDED=false
        MFE_BEHAVIORS_PHASE2=true
      else
        MFE_BOOTSTRAP_NEEDED=true
        MFE_BEHAVIORS_PHASE2=false
      fi
    fi

    # Deploy serial services first
    while IFS= read -r cfg; do
      SVC=$(echo "$cfg" | jq -r '.service')
      if is_service_included "$SVC"; then
        if [ "$PHASE" = "2" ] && [ "$SVC" = "investor-web" ]; then
          deploy_service "$SVC" "$TARGET_REGION" "$TARGET_ACCOUNT" "$cfg" \
            -c mfeBehaviors="$MFE_BEHAVIORS_PHASE2"
        else
          deploy_service "$SVC" "$TARGET_REGION" "$TARGET_ACCOUNT" "$cfg"
        fi
      fi
    done < <(echo "$SERIAL_CONFIGS" | jq -c '.[]')

    # Deploy parallel services concurrently
    PIDS=""
    while IFS= read -r cfg; do
      SVC=$(echo "$cfg" | jq -r '.service')
      if is_service_included "$SVC"; then
        if [ "$PHASE" = "2" ] && [ "$SVC" = "investor-web" ]; then
          deploy_service "$SVC" "$TARGET_REGION" "$TARGET_ACCOUNT" "$cfg" \
            -c mfeBehaviors="$MFE_BEHAVIORS_PHASE2" &
        else
          deploy_service "$SVC" "$TARGET_REGION" "$TARGET_ACCOUNT" "$cfg" &
        fi
        PIDS="$PIDS $!"
      fi
    done < <(echo "$PARALLEL_CONFIGS" | jq -c '.[]')
    FAIL=0
    for PID in $PIDS; do
      wait "$PID" || FAIL=1
    done
    if [ "$FAIL" -ne 0 ]; then echo "ERROR: One or more parallel deploys failed in Phase $PHASE." >&2; exit 1; fi

    # Post-phase verification
    if [ "$PHASE" = "1" ]; then
      echo "Verifying Phase 1 SSM parameters..."
      while IFS= read -r cfg; do
        SVC=$(echo "$cfg" | jq -r '.service')
        if is_service_included "$SVC"; then
          SUBSYSTEM=$(echo "$cfg" | jq -r '.subsystem')
          REGION=$(echo "$cfg" | jq -r '.region // empty')
          verify_ssm_param "/nestfolio/${PREFIX}-${SUBSYSTEM}/event-hub/busArn" "${REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
        fi
      done < <(echo "$PHASE_CONFIGS" | jq -c '.[]')
    fi

    if [ "$PHASE" = "2" ]; then
      echo "Verifying Phase 2 SSM parameters..."
      verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolId" "${TARGET_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
      verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolClientId" "${TARGET_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
    fi
  done

  # Phase 4a: Re-deploy investor-web with full MFE topology (only on cold
  # start). MFE_BOOTSTRAP_NEEDED was captured at Phase 2 — by Phase 4 the
  # BFFs have published their api/apiId + mfe/bucketName SSM exports, so
  # investor-web can now synth + deploy with mfeBehaviors=true.
  if [ "${MFE_BOOTSTRAP_NEEDED:-false}" = "true" ]; then
    if is_service_included "investor-web"; then
      echo ""
      echo "Phase 4a (investor-web re-deploy — cold-start MFE wiring):"
      INVESTOR_WEB_CFG=$(echo "$CONFIGS" | jq -c '.[] | select(.service == "investor-web")' | head -n1)
      deploy_service "investor-web" "$TARGET_REGION" "$TARGET_ACCOUNT" "$INVESTOR_WEB_CFG" \
        -c mfeBehaviors=true
    fi
  fi

  # Phase 4b: Upload shell bundle to investor-web's S3 bucket. Runs after
  # investor-web is in its final state (Phase 2 steady-state OR Phase 4a
  # cold-start re-deploy). Reads bucket name + distribution ID from SSM
  # (web/shellBucketName, web/distributionId).
  if is_service_included "investor-web"; then
    echo ""
    echo "Phase 4b (shell upload):"
    if [ -n "$TARGET_REGION" ]; then
      export CDK_DEFAULT_REGION="$TARGET_REGION"
    fi
    if [ "$DRY_RUN" = "true" ]; then
      echo "  [DRY RUN] Would run: pnpm nx run investor-web:deploy-shell --prefix=$PREFIX"
    else
      pnpm nx run investor-web:deploy-shell --prefix="$PREFIX" || {
        echo "ERROR: Shell upload failed. Tier: $TIER, Prefix: $PREFIX." >&2
        exit 1
      }
    fi
  fi

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
      while IFS= read -r cfg; do
        SVC=$(echo "$cfg" | jq -r '.service')
        if is_service_included "$SVC"; then
          deploy_service "$SVC" "$TARGET_REGION" "$TARGET_ACCOUNT" "$cfg" &
          PIDS="$PIDS $!"
        fi
      done < <(echo "$HUB_CONFIGS" | jq -c '.[]')
      FAIL=0
      for PID in $PIDS; do
        wait "$PID" || FAIL=1
      done
      if [ "$FAIL" -ne 0 ]; then echo "ERROR: One or more hub re-deploys failed." >&2; exit 1; fi
    fi
  fi
done

# Clean up per-service cdk.out directories
rm -rf cdk.out.* 2>/dev/null || true

echo ""
echo "Deployment complete. Tier: $TIER, Prefix: $PREFIX"
