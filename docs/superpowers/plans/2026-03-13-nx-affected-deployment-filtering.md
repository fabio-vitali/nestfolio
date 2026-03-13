# NX Affected Deployment Filtering — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy only NX-affected services on PR updates, staging, and production — while preserving full deploy for manual and PR creation triggers.

**Architecture:** Replace CDK-generated pipeline (`pipeline.app.ts`, `ServiceStage`, `discover-services`) with hand-written GitHub Actions workflows. Add `--services=svc1,svc2` flag to `deploy-all.sh`. Create a shared `compute-affected-services.sh` helper that intersects NX affected output with pipeline.json service names.

**Tech Stack:** Bash, GitHub Actions YAML, NX CLI, `nrwl/nx-set-shas`

**Spec:** `docs/superpowers/specs/2026-03-13-nx-affected-deployment-filtering-design.md`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `deploy-all.sh` | Add `--services=svc1,svc2` filtering flag |
| Create | `.github/scripts/compute-affected-services.sh` | Intersect NX affected with pipeline.json service names |
| Modify | `.github/workflows/pr-deploy.yml` | Split `opened`/`reopened` (full) vs `synchronize` (affected) |
| Create | `.github/workflows/deploy.yml` | Hand-written staging + production workflow |
| Delete | `libs/cdk-constructs/src/service-stage.ts` | No longer needed |
| Delete | `libs/cdk-constructs/test/service-stage.test.ts` | No longer needed |
| Modify | `libs/cdk-constructs/src/index.ts` | Remove ServiceStage exports |
| Delete | `infrastructure/pipeline/src/pipeline.app.ts` | Replaced by hand-written deploy.yml |
| Delete | `infrastructure/pipeline/src/discover-services.ts` | No longer needed (deploy-all.sh reads pipeline.json directly) |
| Delete | `infrastructure/pipeline/test/discover-services.test.ts` | Removed with discover-services |
| Modify | `infrastructure/pipeline/project.json` | Remove `synth` and `test` targets; keep `deploy-role` only |
| Delete | `infrastructure/pipeline/jest.config.ts` | No tests remain |

---

## Chunk 1: deploy-all.sh --services flag

### Task 1: Add --services flag to deploy-all.sh

**Files:**
- Modify: `deploy-all.sh`

The `--services` flag accepts a comma-separated list of service names. When provided, only those services are deployed (phase ordering still applies within the filtered set). When omitted, all services deploy (current behavior). Empty value = skip deployment.

- [ ] **Step 1: Add --services parsing to the flag loop**

In `deploy-all.sh`, replace the flag-parsing block (lines 8-15) with:

```bash
OBSERVABILITY="true"
SERVICES_FILTER=""
shift
for arg in "$@"; do
  case "$arg" in
    --no-observability) OBSERVABILITY="false" ;;
    --services=*) SERVICES_FILTER="${arg#--services=}" ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done
```

- [ ] **Step 2: Add empty-list early exit**

After the flag parsing block (after `done`), add:

```bash
# If --services was passed with an empty value, skip deployment
if [ -n "${SERVICES_FILTER+set}" ] && [ -z "$SERVICES_FILTER" ]; then
  echo "No affected services — skipping deployment."
  exit 0
fi
```

Wait — this won't work because `SERVICES_FILTER=""` is set at init. Instead, use a sentinel approach:

Replace `SERVICES_FILTER=""` with `SERVICES_FILTER=""` and track whether the flag was provided:

```bash
OBSERVABILITY="true"
SERVICES_FILTER=""
SERVICES_FLAG_PROVIDED="false"
shift
for arg in "$@"; do
  case "$arg" in
    --no-observability) OBSERVABILITY="false" ;;
    --services=*) SERVICES_FILTER="${arg#--services=}"; SERVICES_FLAG_PROVIDED="true" ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# If --services was passed with an empty value, skip deployment
if [ "$SERVICES_FLAG_PROVIDED" = "true" ] && [ -z "$SERVICES_FILTER" ]; then
  echo "No affected services — skipping deployment."
  exit 0
fi
```

- [ ] **Step 3: Add service filtering helper function**

After the `deploy_service` function, add:

```bash
is_service_included() {
  local svc="$1"
  # No filter = include everything
  if [ "$SERVICES_FLAG_PROVIDED" = "false" ]; then
    return 0
  fi
  # Check if service is in comma-separated list
  echo ",$SERVICES_FILTER," | grep -q ",$svc,"
}
```

- [ ] **Step 4: Filter services in the phase loop**

In the phase loop (inside `for FILE in $PIPELINE_FILES`), after `SVC=$(jq -r '.service' "$FILE")`, add a filter check:

```bash
      SVC=$(jq -r '.service' "$FILE")

      # Skip if not in affected filter
      if ! is_service_included "$SVC"; then
        continue
      fi
```

- [ ] **Step 5: Filter hub re-deploy (phase 4)**

The hub re-deploy block (lines 119-132) collects `HUB_SERVICES` during phase 1. Since we already filter in step 4, only included hubs get added. However, if no phase-1 hub is in the filtered set, `HUB_SERVICES` will be empty and the block correctly skips. No changes needed — the existing `if [ -n "$HUB_SERVICES" ]` guard handles it.

- [ ] **Step 6: Add --services to the usage comment and log output**

Update line 5:
```bash
PREFIX=${1:?Usage: deploy-all.sh <prefix> [--no-observability] [--services=svc1,svc2,...]}
```

After `echo "Observability: $OBSERVABILITY"`, add:
```bash
if [ "$SERVICES_FLAG_PROVIDED" = "true" ]; then
  echo "Service filter: $SERVICES_FILTER"
else
  echo "Service filter: (all)"
fi
```

- [ ] **Step 7: Test locally with a dry run**

Run: `bash -n deploy-all.sh` (syntax check)
Expected: no output, exit 0

- [ ] **Step 8: Commit**

```bash
git add deploy-all.sh
git commit -m "feat(deploy): add --services flag for filtered deployment"
```

---

## Chunk 2: compute-affected-services.sh helper

### Task 2: Create compute-affected-services.sh

**Files:**
- Create: `.github/scripts/compute-affected-services.sh`

This script takes a base SHA, runs `nx show projects --affected`, and intersects the result with pipeline.json service names to produce a comma-separated list of deployable affected services.

- [ ] **Step 1: Create the script**

```bash
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
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x .github/scripts/compute-affected-services.sh
```

- [ ] **Step 3: Syntax check**

Run: `bash -n .github/scripts/compute-affected-services.sh`
Expected: no output, exit 0

- [ ] **Step 4: Commit**

```bash
git add .github/scripts/compute-affected-services.sh
git commit -m "feat(ci): add compute-affected-services helper script"
```

---

## Chunk 3: PR workflow split (opened vs synchronize)

### Task 3: Rewrite pr-deploy.yml

**Files:**
- Modify: `.github/workflows/pr-deploy.yml`

Split behavior: `opened`/`reopened` does full deploy. `synchronize` computes NX affected and passes `--services` to deploy-all.sh.

- [ ] **Step 1: Rewrite the workflow**

Replace the entire file with:

```yaml
name: PR Deploy Pipeline
on:
  pull_request:
    branches: [main]
    types: [opened, reopened, synchronize]

concurrency:
  group: pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

env:
  PREFIX_SANDBOX: sandbox-pr-${{ github.event.pull_request.number }}

jobs:
  detect-affected:
    runs-on: ubuntu-latest
    outputs:
      affected: ${{ steps.affected.outputs.services }}
      is_full_deploy: ${{ steps.affected.outputs.is_full_deploy }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - id: affected
        run: |
          ACTION="${{ github.event.action }}"
          if [ "$ACTION" = "opened" ] || [ "$ACTION" = "reopened" ]; then
            echo "is_full_deploy=true" >> $GITHUB_OUTPUT
            echo "services=" >> $GITHUB_OUTPUT
          else
            # synchronize — compute affected
            AFFECTED=$(bash .github/scripts/compute-affected-services.sh "${{ github.event.before }}")
            echo "is_full_deploy=false" >> $GITHUB_OUTPUT
            echo "services=$AFFECTED" >> $GITHUB_OUTPUT
          fi

  security-scan:
    needs: detect-affected
    if: needs.detect-affected.outputs.is_full_deploy == 'true' || needs.detect-affected.outputs.affected != ''
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Dependency vulnerability audit
        run: pnpm audit --audit-level=high
      - name: Secret scanning
        run: npx trivy fs --security-checks secret .

  build-and-test:
    needs: detect-affected
    if: needs.detect-affected.outputs.is_full_deploy == 'true' || needs.detect-affected.outputs.affected != ''
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: bash .github/scripts/validate-pipeline-configs.sh
      - run: pnpm nx affected -t lint --base=origin/main --parallel=3
      - run: pnpm nx affected -t test --base=origin/main --parallel=3

  sandbox-deploy:
    needs: [detect-affected, build-and-test, security-scan]
    runs-on: ubuntu-latest
    environment: sandbox
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Verify jq is available
        run: jq --version
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-east-1
      - name: Deploy
        run: |
          export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
          export CDK_DEFAULT_REGION=us-east-1
          IS_FULL="${{ needs.detect-affected.outputs.is_full_deploy }}"
          AFFECTED="${{ needs.detect-affected.outputs.affected }}"
          if [ "$IS_FULL" = "true" ]; then
            bash deploy-all.sh "$PREFIX_SANDBOX"
          else
            bash deploy-all.sh "$PREFIX_SANDBOX" --services="$AFFECTED"
          fi
```

- [ ] **Step 2: Verify YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/pr-deploy.yml'))"`
Expected: no error

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pr-deploy.yml
git commit -m "feat(ci): split PR workflow — full deploy on open, affected on sync"
```

---

## Chunk 4: Staging + Production workflow (deploy.yml)

### Task 4: Create hand-written deploy.yml

**Files:**
- Create: `.github/workflows/deploy.yml`

Replaces the CDK-generated pipeline. Two jobs: staging (auto on push to main) and production (manual approval, same affected set).

- [ ] **Step 1: Create the workflow**

```yaml
name: Deploy Pipeline
on:
  push:
    branches: [main]

concurrency:
  group: deploy-main
  cancel-in-progress: false

jobs:
  staging:
    runs-on: ubuntu-latest
    environment: staging
    permissions:
      id-token: write
      contents: read
    outputs:
      affected: ${{ steps.affected.outputs.services }}
      skipped: ${{ steps.affected.outputs.skipped }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: nrwl/nx-set-shas@v4
        id: setSHAs
      - id: affected
        run: |
          AFFECTED=$(bash .github/scripts/compute-affected-services.sh "${{ steps.setSHAs.outputs.base }}")
          echo "services=$AFFECTED" >> $GITHUB_OUTPUT
          if [ -z "$AFFECTED" ]; then
            echo "skipped=true" >> $GITHUB_OUTPUT
            echo "No affected services — skipping staging deploy."
          else
            echo "skipped=false" >> $GITHUB_OUTPUT
            echo "Affected services: $AFFECTED"
          fi
      - name: Lint and test affected
        if: steps.affected.outputs.skipped == 'false'
        run: |
          pnpm nx affected -t lint --base=${{ steps.setSHAs.outputs.base }} --parallel=3
          pnpm nx affected -t test --base=${{ steps.setSHAs.outputs.base }} --parallel=3
      - name: Deploy to staging
        if: steps.affected.outputs.skipped == 'false'
        run: |
          echo "Deploying affected services to staging: ${{ steps.affected.outputs.services }}"
        # Uncomment when AWS credentials are configured:
        # - uses: aws-actions/configure-aws-credentials@v4
        #   with:
        #     role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
        #     aws-region: us-east-1
        # - run: |
        #     export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
        #     export CDK_DEFAULT_REGION=us-east-1
        #     bash deploy-all.sh staging --services="${{ steps.affected.outputs.services }}"

  production:
    needs: staging
    if: needs.staging.outputs.skipped == 'false'
    runs-on: ubuntu-latest
    environment: production
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Deploy to production
        run: |
          echo "Deploying affected services to production: ${{ needs.staging.outputs.affected }}"
        # Uncomment when AWS credentials are configured:
        # - uses: aws-actions/configure-aws-credentials@v4
        #   with:
        #     role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
        #     aws-region: us-east-1
        # - run: |
        #     export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
        #     export CDK_DEFAULT_REGION=us-east-1
        #     bash deploy-all.sh prod --services="${{ needs.staging.outputs.affected }}"
```

Note: The actual AWS deploy steps are commented out with placeholder echo commands. This is because:
1. The OIDC role (`github-role.stack.ts`) has not been deployed yet
2. Uncommenting requires `AWS_ROLE_ARN` secret to be set in GitHub
3. The placeholder echo lets us validate workflow structure and NX affected logic without AWS access

- [ ] **Step 2: Verify YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"`
Expected: no error

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat(ci): add hand-written staging + production deploy workflow"
```

---

## Chunk 5: Remove CDK pipeline infrastructure

### Task 5: Remove ServiceStage construct

**Files:**
- Delete: `libs/cdk-constructs/src/service-stage.ts`
- Delete: `libs/cdk-constructs/test/service-stage.test.ts`
- Modify: `libs/cdk-constructs/src/index.ts`

- [ ] **Step 1: Remove ServiceStage export from index.ts**

In `libs/cdk-constructs/src/index.ts`, delete this line:
```
export { ServiceStage, ServiceStageProps, StageContext } from './service-stage';
```

- [ ] **Step 2: Delete the files**

```bash
rm libs/cdk-constructs/src/service-stage.ts
rm libs/cdk-constructs/test/service-stage.test.ts
```

- [ ] **Step 3: Run cdk-constructs tests to verify no regressions**

Run: `pnpm nx test cdk-constructs`
Expected: all tests pass (service-stage tests gone, remaining tests unaffected)

- [ ] **Step 4: Commit**

```bash
git add libs/cdk-constructs/src/service-stage.ts libs/cdk-constructs/test/service-stage.test.ts libs/cdk-constructs/src/index.ts
git commit -m "refactor(cdk-constructs): remove ServiceStage construct"
```

### Task 6: Remove pipeline.app.ts and discover-services

**Files:**
- Delete: `infrastructure/pipeline/src/pipeline.app.ts`
- Delete: `infrastructure/pipeline/src/discover-services.ts`
- Delete: `infrastructure/pipeline/test/discover-services.test.ts`
- Delete: `infrastructure/pipeline/jest.config.ts`
- Modify: `infrastructure/pipeline/project.json`

- [ ] **Step 1: Delete the files**

```bash
rm infrastructure/pipeline/src/pipeline.app.ts
rm infrastructure/pipeline/src/discover-services.ts
rm infrastructure/pipeline/test/discover-services.test.ts
rm infrastructure/pipeline/jest.config.ts
```

- [ ] **Step 2: Strip project.json to deploy-role target only**

Replace `infrastructure/pipeline/project.json` with:

```json
{
  "name": "pipeline",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "infrastructure/pipeline/src",
  "projectType": "application",
  "targets": {
    "deploy-role": {
      "executor": "nx:run-commands",
      "options": {
        "command": "TS_NODE_TRANSPILE_ONLY=1 npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js infrastructure/pipeline/src/github-role.app.ts'"
      }
    }
  },
  "tags": ["scope:infrastructure"]
}
```

- [ ] **Step 3: Verify github-role files still compile**

Run: `TS_NODE_TRANSPILE_ONLY=1 npx ts-node -e "require('./infrastructure/pipeline/src/github-role.stack')"`
Expected: no error (file loads successfully)

- [ ] **Step 4: Commit**

```bash
git add infrastructure/pipeline/
git commit -m "refactor(pipeline): remove CDK pipeline app, keep OIDC role only"
```

### Task 7: Verify full test suite

- [ ] **Step 1: Run all tests**

Run: `pnpm nx run-many -t test --parallel=5`
Expected: all projects pass. No project should reference ServiceStage or discover-services.

- [ ] **Step 2: Final commit (if any adjustments needed)**

```bash
git add -A
git commit -m "chore: post-cleanup test verification"
```
