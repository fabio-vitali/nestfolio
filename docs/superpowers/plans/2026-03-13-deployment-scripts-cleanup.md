# Deployment Scripts Cleanup

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four deployment infrastructure issues — gate Phase 4, support multi-region, relocate/rename scripts, replace cdk-pipelines-github with raw CDK.

**Architecture:** Scripts move from repo root to `infrastructure/scripts/`. Phase 4 hub re-deploy becomes conditional on first-deploy detection (region-aware SSM param existence check). Deploy/teardown loops iterate over `production.regions[]` from each service's `pipeline.json`. The `cdk-pipelines-github` dependency is replaced by raw `aws-iam` CDK constructs.

**Tech Stack:** Bash, AWS CDK (TypeScript), GitHub Actions YAML

**Important:** All scripts must be invoked from the repo root (they use `find services ...` with relative paths).

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Move+Rename | `deploy-all.sh` → `infrastructure/scripts/deploy.sh` | Phase-ordered deploy orchestration |
| Move+Rename | `destroy-all.sh` → `infrastructure/scripts/teardown.sh` | Reverse-order teardown |
| Modify | `.github/workflows/deploy.yml` | Update script paths |
| Modify | `.github/workflows/pr-deploy.yml` | Update script paths |
| Modify | `.github/workflows/pr-cleanup.yml` | Update script paths |
| Modify | `infrastructure/pipeline/README.md` | Update docs to match new paths/names |
| Modify | `package.json` | Update npm script paths, remove `cdk-pipelines-github` |
| Modify | `infrastructure/pipeline/src/github-role.stack.ts` | Replace GitHubActionRole with raw IAM |

**Note:** Historical spec/plan files in `docs/superpowers/` reference old script names — these are left as-is (they document past state).

---

## Chunk 1: Relocate and rename scripts

### Task 1: Move deploy-all.sh → infrastructure/scripts/deploy.sh

**Files:**
- Move: `deploy-all.sh` → `infrastructure/scripts/deploy.sh`

- [ ] **Step 1: Create infrastructure/scripts directory and move file**

```bash
mkdir -p infrastructure/scripts
git mv deploy-all.sh infrastructure/scripts/deploy.sh
```

- [ ] **Step 2: Update usage string and header comment inside deploy.sh**

Line 1-2 of `infrastructure/scripts/deploy.sh`:

```bash
#!/usr/bin/env bash
# deploy.sh — Dynamic phase-ordered deployment driven by pipeline.json
```

Line 5:

```bash
PREFIX=${1:?Usage: deploy.sh <prefix> [--no-observability] [--services=svc1,svc2,...]}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: move deploy-all.sh to infrastructure/scripts/deploy.sh"
```

### Task 2: Move destroy-all.sh → infrastructure/scripts/teardown.sh

**Files:**
- Move: `destroy-all.sh` → `infrastructure/scripts/teardown.sh`

- [ ] **Step 1: Move file**

```bash
git mv destroy-all.sh infrastructure/scripts/teardown.sh
```

- [ ] **Step 2: Update usage string and header comment inside teardown.sh**

Line 1-2 of `infrastructure/scripts/teardown.sh`:

```bash
#!/usr/bin/env bash
# teardown.sh — Dynamic reverse-order teardown driven by pipeline.json
```

Line 5:

```bash
PREFIX=${1:?Usage: teardown.sh <prefix>}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: move destroy-all.sh to infrastructure/scripts/teardown.sh"
```

### Task 3: Update all references to old script paths

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/pr-deploy.yml`
- Modify: `.github/workflows/pr-cleanup.yml`
- Modify: `package.json`
- Modify: `infrastructure/pipeline/README.md`

- [ ] **Step 1: Update deploy.yml**

Replace all occurrences of `deploy-all.sh` with `infrastructure/scripts/deploy.sh`:

```yaml
# Line 72 (staging deploy, commented out):
# bash infrastructure/scripts/deploy.sh staging --services="${{ steps.affected.outputs.services }}"

# Line 98 (production deploy, commented out):
# bash infrastructure/scripts/deploy.sh prod --services="${{ needs.staging.outputs.affected }}"
```

- [ ] **Step 2: Update pr-deploy.yml**

```yaml
# Line 96:
bash infrastructure/scripts/deploy.sh "$PREFIX_SANDBOX"
# Line 98:
bash infrastructure/scripts/deploy.sh "$PREFIX_SANDBOX" --services="$AFFECTED"
```

- [ ] **Step 3: Update pr-cleanup.yml**

```yaml
# Line 37:
- run: echo "yes" | bash infrastructure/scripts/teardown.sh "sandbox-pr-${{ env.PR_NUMBER }}"
```

- [ ] **Step 4: Update package.json npm scripts**

```json
"deploy": "bash infrastructure/scripts/deploy.sh",
"destroy": "bash infrastructure/scripts/teardown.sh"
```

- [ ] **Step 5: Update infrastructure/pipeline/README.md**

Replace all `deploy-all.sh` references with `infrastructure/scripts/deploy.sh` and `destroy-all.sh` with `infrastructure/scripts/teardown.sh`. Update the manual deployment examples:

```markdown
## Manual Deployment

\```bash
# Deploy with observability (default)
bash infrastructure/scripts/deploy.sh dev

# Deploy without observability (lighter, cheaper)
bash infrastructure/scripts/deploy.sh dev --no-observability

# Deploy specific services only
bash infrastructure/scripts/deploy.sh dev --services="investor-bff,advisory-ctrl"

# Tear down
bash infrastructure/scripts/teardown.sh dev
\```
```

Also update the Deployment Paths table:

```markdown
| Manual | `bash infrastructure/scripts/deploy.sh <prefix>` | Direct stack deploys | `--no-observability` flag to disable |
| Sandbox (PR) | PR to main | `pr-deploy.yml` → `deploy.sh` | Configurable per PR |
| Staging | Push to main | `deploy.yml` → NX affected → `deploy.sh` | Enabled |
| Production | After staging | GitHub Environment approval → `deploy.sh` | Enabled |
| Hotfix | Manual dispatch | `deploy.yml` workflow_dispatch with `--services` | Enabled |
```

- [ ] **Step 6: Verify no remaining references to old names**

```bash
grep -r "deploy-all\.sh\|destroy-all\.sh" --include='*.yml' --include='*.yaml' --include='*.json' --include='*.md' --include='*.sh' . | grep -v node_modules | grep -v docs/superpowers
```

Expected: no matches. (Historical files in `docs/superpowers/` are left as-is.)

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ package.json infrastructure/pipeline/README.md
git commit -m "refactor: update all references to new script paths"
```

---

## Chunk 2: Multi-region iteration + Phase 4 gating

Chunks 2 and 3 (Phase 4 gating) are merged because Phase 4 gating needs region-awareness, which depends on the multi-region work.

### Task 4: Add region iteration to deploy.sh

**Files:**
- Modify: `infrastructure/scripts/deploy.sh`

Currently `deploy_service` deploys once (relying on `CDK_DEFAULT_REGION`). The schema supports `production.regions[]` but the script ignores it. Fix: read regions from `pipeline.json` and deploy once per region.

- [ ] **Step 1: Modify `deploy_service` to accept a region parameter**

Replace the existing `deploy_service` function:

```bash
deploy_service() {
  local svc="$1"
  local region="${2:-$CDK_DEFAULT_REGION}"
  region="${region:-us-east-1}"
  echo "  Deploying $svc (${region})..."
  CDK_DEFAULT_REGION="$region" pnpm nx run "$svc:deploy" -- \
    --prefix="$PREFIX" $APPROVAL_FLAG \
    -c observability="$OBSERVABILITY" \
    -c region="$region"
}
```

- [ ] **Step 2: Add region-aware `verify_ssm_param` and `check_all_hub_params_exist` functions**

Replace the existing `verify_ssm_param` function and add `check_all_hub_params_exist` after it:

```bash
verify_ssm_param() {
  local param_name="$1"
  local region="${2:-$CDK_DEFAULT_REGION}"
  region="${region:-us-east-1}"
  if ! aws ssm get-parameter --name "$param_name" --region "$region" --query 'Parameter.Value' --output text > /dev/null 2>&1; then
    echo "ERROR: SSM parameter $param_name not found in $region after deployment." >&2
    exit 1
  fi
}

# Returns 0 if ALL hub bus-ARN SSM parameters exist (in all regions), 1 otherwise.
# Used to gate Phase 4 — the re-deploy is only needed on first deploy.
check_all_hub_params_exist() {
  local entries="$1"
  for ENTRY in $entries; do
    local svc="${ENTRY%%:*}"
    local region="${ENTRY##*:}"
    # Find the subsystem for this service from pipeline.json
    for FILE in $PIPELINE_FILES; do
      if [ "$(jq -r '.service' "$FILE")" = "$svc" ]; then
        local subsystem=$(jq -r '.subsystem' "$FILE")
        local param="/nestfolio/${PREFIX}-${subsystem}/event-hub/busArn"
        if ! aws ssm get-parameter --name "$param" --region "$region" --query 'Parameter.Value' --output text > /dev/null 2>&1; then
          return 1
        fi
        break
      fi
    done
  done
  return 0
}
```

- [ ] **Step 3: Replace HUB_SERVICES with HUB_ENTRIES (svc:region pairs)**

Replace the `HUB_SERVICES=""` initialization near line 74 with:

```bash
HUB_ENTRIES=""
```

- [ ] **Step 4: Replace the entire phase loop with region-aware version**

Replace the `for PHASE in 1 2 3` loop and Phase 4 block with:

```bash
# Deploy by phase (1, 2, 3)
for PHASE in 1 2 3; do
  PARALLEL_SERVICES=""
  SERIAL_SERVICES=""

  for FILE in $PIPELINE_FILES; do
    FILE_PHASE=$(jq -r '.deploymentPhase' "$FILE")
    if [ "$FILE_PHASE" = "$PHASE" ]; then
      SVC=$(jq -r '.service' "$FILE")

      # Skip if not in affected filter
      if ! is_service_included "$SVC"; then
        continue
      fi

      PARALLEL=$(jq -r '.production.parallelDeploy' "$FILE")
      REGIONS=$(jq -r '.production.regions[]' "$FILE")

      for REGION in $REGIONS; do
        ENTRY="${SVC}:${REGION}"

        if [ "$PHASE" = "1" ]; then
          HUB_ENTRIES="$HUB_ENTRIES $ENTRY"
        fi

        if [ "$PARALLEL" = "true" ]; then
          PARALLEL_SERVICES="$PARALLEL_SERVICES $ENTRY"
        else
          SERIAL_SERVICES="$SERIAL_SERVICES $ENTRY"
        fi
      done
    fi
  done

  if [ -z "$PARALLEL_SERVICES$SERIAL_SERVICES" ]; then
    continue
  fi

  echo ""
  echo "Phase $PHASE:$SERIAL_SERVICES$PARALLEL_SERVICES"

  # Deploy serial services first
  for ENTRY in $SERIAL_SERVICES; do
    SVC="${ENTRY%%:*}"
    REGION="${ENTRY##*:}"
    deploy_service "$SVC" "$REGION"
  done

  # Deploy parallel services concurrently
  PIDS=""
  for ENTRY in $PARALLEL_SERVICES; do
    SVC="${ENTRY%%:*}"
    REGION="${ENTRY##*:}"
    deploy_service "$SVC" "$REGION" &
    PIDS="$PIDS $!"
  done
  FAIL=0
  for PID in $PIDS; do
    wait "$PID" || FAIL=1
  done
  if [ "$FAIL" -ne 0 ]; then echo "ERROR: One or more parallel deploys failed in Phase $PHASE." >&2; exit 1; fi

  # Post-phase verification
  if [ "$PHASE" = "1" ]; then
    echo "Verifying Phase 1 SSM parameters..."
    for FILE in $PIPELINE_FILES; do
      FILE_PHASE=$(jq -r '.deploymentPhase' "$FILE")
      if [ "$FILE_PHASE" = "1" ]; then
        SUBSYSTEM=$(jq -r '.subsystem' "$FILE")
        SVC=$(jq -r '.service' "$FILE")
        if is_service_included "$SVC"; then
          REGIONS=$(jq -r '.production.regions[]' "$FILE")
          for REGION in $REGIONS; do
            verify_ssm_param "/nestfolio/${PREFIX}-${SUBSYSTEM}/event-hub/busArn" "$REGION"
          done
        fi
      fi
    done
  fi

  if [ "$PHASE" = "2" ]; then
    echo "Verifying Phase 2 SSM parameters..."
    verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolId"
    verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolClientId"
  fi
done

# Phase 4: Re-deploy hubs (only needed on first deploy when SSM params didn't exist yet)
if [ -n "$HUB_ENTRIES" ]; then
  if check_all_hub_params_exist "$HUB_ENTRIES"; then
    echo ""
    echo "Phase 4 (hub re-deploy): SKIPPED — all hub SSM parameters already exist."
  else
    echo ""
    echo "Phase 4 (hub re-deploy — first deploy detected):$HUB_ENTRIES"
    PIDS=""
    for ENTRY in $HUB_ENTRIES; do
      SVC="${ENTRY%%:*}"
      REGION="${ENTRY##*:}"
      deploy_service "$SVC" "$REGION" &
      PIDS="$PIDS $!"
    done
    FAIL=0
    for PID in $PIDS; do
      wait "$PID" || FAIL=1
    done
    if [ "$FAIL" -ne 0 ]; then echo "ERROR: One or more hub re-deploys failed." >&2; exit 1; fi
  fi
fi

echo ""
echo "Deployment complete for prefix: $PREFIX"
```

- [ ] **Step 5: Test locally**

```bash
bash -n infrastructure/scripts/deploy.sh
```

- [ ] **Step 6: Commit**

```bash
git add infrastructure/scripts/deploy.sh
git commit -m "feat(deploy): add multi-region iteration and gate Phase 4 behind first-deploy check"
```

### Task 5: Add region iteration to teardown.sh

**Files:**
- Modify: `infrastructure/scripts/teardown.sh`

- [ ] **Step 1: Update `destroy_service` to accept a region**

```bash
destroy_service() {
  local svc="$1"
  local region="${2:-$CDK_DEFAULT_REGION}"
  region="${region:-us-east-1}"
  echo "  Destroying $svc (${region})..."
  CDK_DEFAULT_REGION="$region" pnpm nx run "$svc:destroy" -- \
    --prefix="$PREFIX" $APPROVAL_FLAG \
    -c region="$region"
}
```

- [ ] **Step 2: Replace the phase loop with region-aware version**

Teardown continues on phase failure (partial teardown is worse than trying all phases):

```bash
# Teardown in reverse phase order (3, 2, 1)
TEARDOWN_FAIL=0
for PHASE in 3 2 1; do
  PARALLEL_SERVICES=""
  SERIAL_SERVICES=""

  for FILE in $PIPELINE_FILES; do
    FILE_PHASE=$(jq -r '.deploymentPhase' "$FILE")
    if [ "$FILE_PHASE" = "$PHASE" ]; then
      SVC=$(jq -r '.service' "$FILE")
      PARALLEL=$(jq -r '.production.parallelDeploy' "$FILE")
      REGIONS=$(jq -r '.production.regions[]' "$FILE")
      for REGION in $REGIONS; do
        ENTRY="${SVC}:${REGION}"
        if [ "$PARALLEL" = "true" ]; then
          PARALLEL_SERVICES="$PARALLEL_SERVICES $ENTRY"
        else
          SERIAL_SERVICES="$SERIAL_SERVICES $ENTRY"
        fi
      done
    fi
  done

  if [ -z "$PARALLEL_SERVICES$SERIAL_SERVICES" ]; then
    continue
  fi

  echo ""
  echo "Phase $PHASE (teardown):$SERIAL_SERVICES$PARALLEL_SERVICES"

  # Destroy parallel services concurrently
  PIDS=""
  for ENTRY in $PARALLEL_SERVICES; do
    SVC="${ENTRY%%:*}"
    REGION="${ENTRY##*:}"
    destroy_service "$SVC" "$REGION" &
    PIDS="$PIDS $!"
  done
  FAIL=0
  for PID in $PIDS; do
    wait "$PID" || FAIL=1
  done
  if [ "$FAIL" -ne 0 ]; then
    echo "WARNING: One or more parallel teardowns failed in Phase $PHASE. Continuing..." >&2
    TEARDOWN_FAIL=1
  fi

  # Destroy serial services
  for ENTRY in $SERIAL_SERVICES; do
    SVC="${ENTRY%%:*}"
    REGION="${ENTRY##*:}"
    destroy_service "$SVC" "$REGION" || { echo "WARNING: Teardown of $SVC ($REGION) failed. Continuing..." >&2; TEARDOWN_FAIL=1; }
  done
done

echo ""
if [ "$TEARDOWN_FAIL" -ne 0 ]; then
  echo "Teardown completed with errors for prefix: $PREFIX — check logs above." >&2
  exit 1
else
  echo "Teardown complete for prefix: $PREFIX"
fi
```

- [ ] **Step 3: Test locally**

```bash
bash -n infrastructure/scripts/teardown.sh
```

- [ ] **Step 4: Commit**

```bash
git add infrastructure/scripts/teardown.sh
git commit -m "feat(teardown): add multi-region iteration with continue-on-failure"
```

---

## Chunk 3: Replace cdk-pipelines-github with raw CDK

### Task 6: Rewrite github-role.stack.ts with raw IAM constructs

**Files:**
- Modify: `infrastructure/pipeline/src/github-role.stack.ts`
- Modify: `package.json` (remove dependency)
- Modify: `infrastructure/pipeline/README.md`

**Migration note:** If this stack was previously deployed with `cdk-pipelines-github`, the old OIDC provider resource will be destroyed and a new one created. Since there can only be one OIDC provider per issuer URL per AWS account, you must either: (a) destroy the old stack first then deploy the new one, or (b) import the existing provider using `OpenIdConnectProvider.fromOpenIdConnectProviderArn()`. Option (a) is simpler for a bootstrap stack that's deployed once. If the stack has never been deployed, no migration is needed.

- [ ] **Step 1: Replace GitHubActionRole with raw OIDC + IAM**

The `OpenIdConnectPrincipal` constructor automatically adds a `StringEquals` condition for the `aud` claim matching the `clientIds` provided to the OIDC provider. This ensures the trust policy is properly scoped.

```typescript
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import {
  OpenIdConnectProvider,
  OpenIdConnectPrincipal,
  Role,
  ManagedPolicy,
} from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface GitHubRoleStackProps extends StackProps {
  repos: string[];
}

export class GitHubRoleStack extends Stack {
  constructor(scope: Construct, id: string, props: GitHubRoleStackProps) {
    super(scope, id, props);

    const provider = new OpenIdConnectProvider(this, 'GitHubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const role = new Role(this, 'GitHubRole', {
      roleName: 'nestfolio-github-actions-role',
      assumedBy: new OpenIdConnectPrincipal(provider, {
        StringLike: {
          'token.actions.githubusercontent.com:sub': props.repos.map(
            (repo) => `repo:${repo}:*`,
          ),
        },
      }),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
    });

    new CfnOutput(this, 'RoleArn', {
      value: role.roleArn,
      description: 'ARN of the GitHub Actions OIDC role',
    });
  }
}
```

- [ ] **Step 2: Verify github-role.app.ts still works (no changes needed)**

`github-role.app.ts` only imports `GitHubRoleStack` — interface is unchanged (`repos: string[]`), so no modifications needed.

- [ ] **Step 3: Remove cdk-pipelines-github from package.json**

```bash
pnpm remove cdk-pipelines-github
```

- [ ] **Step 4: Verify no remaining imports**

```bash
grep -r "cdk-pipelines-github" --include='*.ts' --include='*.js' . | grep -v node_modules
```

Expected: no matches.

- [ ] **Step 5: Update infrastructure/pipeline/README.md**

Replace the Dependencies section:

```markdown
## Dependencies

The GitHub OIDC role uses standard `aws-cdk-lib/aws-iam` constructs (`OpenIdConnectProvider`, `Role`). No additional CDK libraries are required.

### Migration from cdk-pipelines-github

If the `nestfolio-github-role` stack was previously deployed using `cdk-pipelines-github`, destroy the old stack before deploying the new one:

\```bash
npx cdk destroy \
  --app 'npx ts-node -r ./tools/register-paths.js infrastructure/pipeline/src/github-role.app.ts' \
  nestfolio-github-role
\```

Then re-deploy with the new constructs (see Quick Start above).
```

- [ ] **Step 6: Commit**

```bash
git add infrastructure/pipeline/src/github-role.stack.ts package.json pnpm-lock.yaml infrastructure/pipeline/README.md
git commit -m "refactor(pipeline): replace cdk-pipelines-github with raw IAM OIDC constructs"
```

---

## Execution Order

Tasks 1-3 (Chunk 1) → Tasks 4-5 (Chunk 2) → Task 6 (Chunk 3)

Chunks 1 and 3 are independent, but Chunk 2 modifies the scripts moved in Chunk 1 — so Chunk 1 must complete first. Execute sequentially: Chunk 1 → Chunk 2 → Chunk 3. Chunk 3 (CDK) can technically run in parallel with Chunk 2, as it touches different files.
