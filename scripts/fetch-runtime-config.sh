#!/usr/bin/env bash
#
# fetch-runtime-config.sh — runtime config producer.
#
# Reads the runtime-config SSM parameters published by the investor subsystem
# (auth, BFF AppSync endpoints, web distribution URL) and writes
# apps/nestfolio-host/public/assets/config.json.
#
# This is the only producer of the shell's runtime-config payload.
#
# Usage:
#   bash scripts/fetch-runtime-config.sh --prefix=<prefix> [--region=<region>]
#
# Exits non-zero with a named-path error if any SSM parameter is missing or
# AWS credentials are unavailable. No silent fallback.
#
set -euo pipefail

PREFIX=""
# Region for SSM queries. Resolved from --region, then AWS_REGION /
# AWS_DEFAULT_REGION env vars. No hardcoded fallback — if none of these are
# set and --region is not passed, the AWS CLI's own resolution chain takes
# over (~/.aws/config), and errors clearly if that also fails.
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"

usage() {
  cat >&2 <<EOF
Usage: bash scripts/fetch-runtime-config.sh --prefix=<prefix> [--region=<region>]

  --prefix    Required. SSM parameter prefix (e.g. dev, staging, prod).
  --region    Optional. AWS region for SSM queries. Defaults to AWS_REGION
              or AWS_DEFAULT_REGION env var, then ~/.aws/config.
EOF
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix=*) PREFIX="${1#*=}"; shift ;;
    --prefix)   PREFIX="${2:-}"; shift 2 ;;
    --region=*) REGION="${1#*=}"; shift ;;
    --region)   REGION="${2:-}"; shift 2 ;;
    -h|--help)  usage ;;
    *) echo "Unknown argument: $1" >&2; usage ;;
  esac
done

[[ -n "$PREFIX" ]] || usage

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found. Install via your package manager." >&2
  exit 127
fi

# Output path. Tests override the output root via RUNTIME_CONFIG_OUT_ROOT.
OUT_ROOT="${RUNTIME_CONFIG_OUT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
OUT_PATH="${OUT_ROOT}/apps/nestfolio-host/public/assets/config.json"

# Reads one SSM parameter. Names the path + remediation in the failure message.
# Passes --region only when it has been resolved (flag, AWS_REGION,
# AWS_DEFAULT_REGION). Otherwise lets the AWS CLI use its own region
# resolution chain (~/.aws/config) and emit its own diagnostic if absent.
get_ssm() {
  local path="$1"
  local owning_service="$2"
  local value
  if [[ -n "$REGION" ]]; then
    value="$(aws ssm get-parameter --region "$REGION" --name "$path" --query 'Parameter.Value' --output text 2>&1)" || {
      cat >&2 <<EOF
SSM param not found or unreadable: ${path}
Run \`bash infrastructure/scripts/deploy.sh sandbox --prefix=${PREFIX} --services=${owning_service}\` first.
(aws stderr was: ${value})
EOF
      exit 1
    }
    printf '%s' "$value"
    return 0
  fi
  if ! value="$(aws ssm get-parameter --name "$path" --query 'Parameter.Value' --output text 2>&1)"; then
    cat >&2 <<EOF
SSM param not found or unreadable: ${path}
Run \`bash infrastructure/scripts/deploy.sh sandbox --prefix=${PREFIX} --services=${owning_service}\` first.
(aws stderr was: ${value})
EOF
    exit 1
  fi
  printf '%s' "$value"
}

USER_POOL_ID="$(get_ssm "/nestfolio/${PREFIX}-investor/auth/userPoolId" "investor-web")"
CLIENT_ID="$(get_ssm "/nestfolio/${PREFIX}-investor/auth/userPoolClientId" "investor-web")"
AUTH_REGION="$(get_ssm "/nestfolio/${PREFIX}-investor/auth/region" "investor-web")"
DIST_URL="$(get_ssm "/nestfolio/${PREFIX}-investor/web/distributionUrl" "investor-web")"
INVESTOR_BFF_URL="$(get_ssm "/nestfolio/${PREFIX}-investor-bff/api/graphqlUrl" "investor-bff")"
ADVISORY_BFF_URL="$(get_ssm "/nestfolio/${PREFIX}-advisory-bff/api/graphqlUrl" "advisory-bff")"
LEDGER_BFF_URL="$(get_ssm "/nestfolio/${PREFIX}-ledger-bff/api/graphqlUrl" "ledger-bff")"
DASHBOARD_BFF_URL="$(get_ssm "/nestfolio/${PREFIX}-dashboard-bff/api/graphqlUrl" "dashboard-bff")"

# JSON encoder: minimal, used per-string to escape backslash and double-quote.
json_str() { printf '"%s"' "${1//\"/\\\"}" ; }

mkdir -p "$(dirname "$OUT_PATH")"
{
  printf '{\n'
  printf '  "auth": {\n'
  printf '    "userPoolId": %s,\n' "$(json_str "$USER_POOL_ID")"
  printf '    "clientId": %s,\n'   "$(json_str "$CLIENT_ID")"
  printf '    "region": %s\n'      "$(json_str "$AUTH_REGION")"
  printf '  },\n'
  printf '  "appsync": {\n'
  printf '    "investorBff":  { "endpoint": %s, "region": %s },\n' "$(json_str "$INVESTOR_BFF_URL")"  "$(json_str "$AUTH_REGION")"
  printf '    "advisoryBff":  { "endpoint": %s, "region": %s },\n' "$(json_str "$ADVISORY_BFF_URL")"  "$(json_str "$AUTH_REGION")"
  printf '    "dashboardBff": { "endpoint": %s, "region": %s },\n' "$(json_str "$DASHBOARD_BFF_URL")" "$(json_str "$AUTH_REGION")"
  printf '    "ledgerBff":    { "endpoint": %s, "region": %s }\n'  "$(json_str "$LEDGER_BFF_URL")"    "$(json_str "$AUTH_REGION")"
  printf '  },\n'
  printf '  "copilotApiUrl": %s\n' "$(json_str "${DIST_URL}/api/copilotkit")"
  printf '}\n'
} > "$OUT_PATH"

echo "Wrote ${OUT_PATH}"
