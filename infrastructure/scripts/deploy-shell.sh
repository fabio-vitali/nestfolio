#!/usr/bin/env bash
# deploy-shell.sh — Upload built nestfolio-host shell to investor-web's S3
# bucket and invalidate the CloudFront paths the shell owns.
#
# Discovery: SSM (web/shellBucketName, web/distributionId) under the
# investor subsystem (Pillar 3 — see MFE charter §5 row 9a).
#
# Region resolution mirrors deploy.sh:95 — $2 takes precedence, then
# $CDK_DEFAULT_REGION, then us-east-1.
#
# Invalidation paths are surgical: only paths the shell owns under the
# default CloudFront behavior. /mfe/<key>/* is owned by per-BFF stacks
# and is NEVER invalidated by this script.

set -euo pipefail

PREFIX=${1:?Usage: deploy-shell.sh <prefix> [region] [--dry-run]}
shift

REGION_ARG=""
DRY_RUN="false"
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="true" ;;
    *) REGION_ARG="$arg" ;;
  esac
done

REGION="${REGION_ARG:-${CDK_DEFAULT_REGION:-us-east-1}}"

trap 'echo "ERROR: Shell deploy failed. Prefix: $PREFIX, Region: $REGION." >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIST_DIR="$REPO_ROOT/dist/apps/nestfolio-host/browser"

if [ ! -d "$DIST_DIR" ]; then
  echo "ERROR: Shell bundle not found at $DIST_DIR." >&2
  echo "Run 'pnpm nx run nestfolio-host:build' first." >&2
  exit 1
fi

BUCKET_PARAM="/nestfolio/${PREFIX}-investor/web/shellBucketName"
DIST_ID_PARAM="/nestfolio/${PREFIX}-investor/web/distributionId"

BUCKET=$(aws ssm get-parameter --name "$BUCKET_PARAM" --region "$REGION" \
  --query 'Parameter.Value' --output text)
DIST_ID=$(aws ssm get-parameter --name "$DIST_ID_PARAM" --region "$REGION" \
  --query 'Parameter.Value' --output text)

echo "Shell deploy: prefix=$PREFIX region=$REGION"
echo "  Bucket:        $BUCKET"
echo "  Distribution:  $DIST_ID"
echo "  Dist dir:      $DIST_DIR"

if [ "$DRY_RUN" = "true" ]; then
  echo "  [DRY RUN] Would: aws s3 sync $DIST_DIR s3://$BUCKET --delete --region $REGION"
  echo "  [DRY RUN] Would: aws cloudfront create-invalidation --distribution-id $DIST_ID --paths /index.html /assets/* /remoteEntry.json"
  exit 0
fi

aws s3 sync "$DIST_DIR" "s3://$BUCKET" --delete --region "$REGION"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
  --paths /index.html "/assets/*" /remoteEntry.json >/dev/null
echo "Shell deployed."
