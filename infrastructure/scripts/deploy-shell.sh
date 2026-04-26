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

# Subsystem is hardcoded to `investor` because investor-web is the only
# service that publishes these exports (charter §5 row 9a). If investor-web
# ever moves subsystem, update both literals here.
BUCKET_PARAM="/nestfolio/${PREFIX}-investor/web/shellBucketName"
DIST_ID_PARAM="/nestfolio/${PREFIX}-investor/web/distributionId"

resolve_param() {
  local name="$1"
  if ! aws ssm get-parameter --name "$name" --region "$REGION" \
       --query 'Parameter.Value' --output text 2>/dev/null; then
    echo "ERROR: SSM parameter $name not found in $REGION." >&2
    echo "Has investor-web been deployed for prefix '$PREFIX'?" >&2
    echo "  bash infrastructure/scripts/deploy.sh sandbox --prefix=$PREFIX --services=investor-web" >&2
    exit 1
  fi
}

BUCKET=$(resolve_param "$BUCKET_PARAM")
DIST_ID=$(resolve_param "$DIST_ID_PARAM")

echo "Shell deploy: prefix=$PREFIX region=$REGION"
echo "  Bucket:        $BUCKET"
echo "  Distribution:  $DIST_ID"
echo "  Dist dir:      $DIST_DIR"

# Overwrite the dev federation.manifest.json (committed at
# apps/nestfolio-host/public/assets/federation.manifest.json with
# localhost dev URLs) with the production manifest pointing at
# /mfe/<key>/remoteEntry.json paths served by the unified CloudFront
# distribution. Single source of truth: MFE_CATALOG (read by
# build-prod-manifest.mjs via list-mfe-catalog.mjs).
PROD_MANIFEST="$DIST_DIR/assets/federation.manifest.json"
echo "  Manifest:      $PROD_MANIFEST"
node "$REPO_ROOT/tools/scripts/build-prod-manifest.mjs" --out "$PROD_MANIFEST"

if [ "$DRY_RUN" = "true" ]; then
  echo "  [DRY RUN] Would: aws s3 sync $DIST_DIR s3://$BUCKET --delete --region $REGION"
  echo "  [DRY RUN] Would: aws cloudfront create-invalidation --distribution-id $DIST_ID --paths /index.html /assets/* /remoteEntry.json"
  exit 0
fi

aws s3 sync "$DIST_DIR" "s3://$BUCKET" --delete --region "$REGION"
# Surgical invalidation — only paths the shell controls under the default
# CloudFront behavior:
#   /index.html        — Angular emits at root, unhashed (references hashed bundles)
#   /assets/*          — runtime-config.json, favicons, etc. (unhashed)
#   /remoteEntry.json  — Native Federation host manifest (unhashed)
# Hashed bundles (main.<hash>.js, etc.) need no invalidation — new builds emit new filenames.
aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
  --paths /index.html "/assets/*" /remoteEntry.json >/dev/null
echo "Shell deployed."
