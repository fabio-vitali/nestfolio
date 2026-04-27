#!/usr/bin/env bash
#
# deploy-mfe.sh — Upload one built MFE bundle to its BFF's S3 bucket
# and invalidate the matching CloudFront /mfe/<key>/* paths.
#
# Discovery:
#   - bucket  → SSM /nestfolio/<prefix>-<bff>/mfe/bucketName
#   - distId  → SSM /nestfolio/<prefix>-investor/web/distributionId
#                (single distribution per charter §5 row 9a)
#
# Region resolution mirrors deploy.sh: $3 takes precedence, then
# $CDK_DEFAULT_REGION, then us-east-1.
#
# Invalidation paths are surgical: only /mfe/<key>/* — the shell's paths
# are owned by deploy-shell.sh and are NEVER invalidated by this script.
#
# Usage:
#   deploy-mfe.sh <prefix> <key> [region] [--dry-run]
#
# Where <key> is an MFE_CATALOG key (investor, advisory, ledger,
# dashboard, onboarding) and matches the BFF service via <key>-bff.

set -euo pipefail

PREFIX=${1:?Usage: deploy-mfe.sh <prefix> <key> [region] [--dry-run]}
KEY=${2:?Usage: deploy-mfe.sh <prefix> <key> [region] [--dry-run]}
shift 2

REGION_ARG=""
DRY_RUN="false"
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="true" ;;
    *) REGION_ARG="$arg" ;;
  esac
done

REGION="${REGION_ARG:-${CDK_DEFAULT_REGION:-us-east-1}}"

trap 'echo "ERROR: MFE deploy failed. Prefix: $PREFIX, Key: $KEY, Region: $REGION." >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIST_DIR="$REPO_ROOT/dist/apps/${KEY}-mfe/browser"

if [ ! -d "$DIST_DIR" ]; then
  echo "ERROR: MFE bundle not found at $DIST_DIR." >&2
  echo "Run 'pnpm nx run ${KEY}-mfe:build' first." >&2
  exit 1
fi

BFF_SERVICE="${KEY}-bff"
BUCKET_PARAM="/nestfolio/${PREFIX}-${BFF_SERVICE}/mfe/bucketName"
DIST_ID_PARAM="/nestfolio/${PREFIX}-investor/web/distributionId"

resolve_param() {
  local name="$1"
  local owner="$2"
  if ! aws ssm get-parameter --name "$name" --region "$REGION" \
       --query 'Parameter.Value' --output text 2>/dev/null; then
    echo "ERROR: SSM parameter $name not found in $REGION." >&2
    echo "Has $owner been deployed for prefix '$PREFIX'?" >&2
    echo "  bash infrastructure/scripts/deploy.sh sandbox --prefix=$PREFIX --services=$owner" >&2
    exit 1
  fi
}

BUCKET=$(resolve_param "$BUCKET_PARAM" "$BFF_SERVICE")
DIST_ID=$(resolve_param "$DIST_ID_PARAM" "investor-web")

echo "MFE deploy: prefix=$PREFIX key=$KEY region=$REGION"
echo "  Bucket:        $BUCKET"
echo "  Distribution:  $DIST_ID"
echo "  Dist dir:      $DIST_DIR"

if [ "$DRY_RUN" = "true" ]; then
  echo "  [DRY RUN] Would: aws s3 sync $DIST_DIR s3://$BUCKET --delete --region $REGION"
  echo "  [DRY RUN] Would: aws cloudfront create-invalidation --distribution-id $DIST_ID --paths /mfe/$KEY/*"
  exit 0
fi

aws s3 sync "$DIST_DIR" "s3://$BUCKET" --delete --region "$REGION"

aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" \
  --paths "/mfe/$KEY/*" \
  >/dev/null

echo "MFE deployed: $KEY → s3://$BUCKET (invalidated /mfe/$KEY/*)."
