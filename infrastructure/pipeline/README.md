# Nestfolio Deployment Pipeline

## Overview

Nestfolio uses a **convention-over-configuration** pipeline: service metadata is inferred from directory structure, tier-level defaults live in a single `pipeline-defaults.json`, and per-service `pipeline.json` overrides are only needed when a service deviates from convention.

### Architecture

```
infrastructure/
├── pipeline-defaults.json          # Tier-level defaults (sandbox/staging/production)
├── pipeline-defaults-schema.json   # JSON Schema for pipeline-defaults.json
└── scripts/
    ├── deploy.sh                   # Phase-ordered deployment orchestrator
    ├── teardown.sh                 # Reverse-order teardown
    └── resolve-all-configs.ts      # Resolves all service configs (used by deploy.sh)

.pipeline-schema.json               # JSON Schema for per-service overrides

services/{subsystem}/{service}/
├── pipeline.json                   # OPTIONAL — only when overriding convention
└── src/main.ts                     # CDK entry point (presence = deployable service)
```

### Configuration Resolution (3-Layer Merge)

Each service's deployment config is resolved by merging three layers. Later layers override earlier ones:

| Layer | Source | Purpose |
|-------|--------|---------|
| 1. Inferred | Directory structure + naming | subsystem, phase, dependencies |
| 2. Tier defaults | `infrastructure/pipeline-defaults.json` | observability, log retention, resource protection |
| 3. Per-service | `services/{sub}/{svc}/pipeline.json` | Overrides for services that deviate from convention |

---

## Quick Start

### Prerequisites

- Node.js v24+ (native TypeScript support)
- AWS CLI configured with valid credentials
- CDK bootstrapped in target account/region (`cdk bootstrap aws://{account}/{region}`)
- GitHub OIDC role deployed (see [GitHub Role Setup](#github-oidc-role-setup) below)

### Deploy (Local)

```bash
# Dry-run — see what would be deployed without deploying
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --dry-run

# Deploy all services to sandbox tier
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev

# Deploy specific services only
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,advisory-ctrl

# Tear down a sandbox environment
bash infrastructure/scripts/teardown.sh dev
```

### deploy.sh Reference

```
deploy.sh <tier> [--prefix=<custom>] [--services=svc1,svc2,...] [--dry-run]

Arguments:
  <tier>              sandbox | staging | prod | production

Options:
  --prefix=<name>     Override the default prefix (default: tier name)
  --services=<list>   Comma-separated list of services to deploy (default: all)
  --dry-run           Print resolved configs and deployment plan without deploying
```

**Default prefixes:** `sandbox` → `sandbox`, `staging` → `staging`, `prod` → `prod`

---

## Environment Tiers

| Tier | Purpose | Prefix | Lifecycle |
|------|---------|--------|-----------|
| **Sandbox** | Ephemeral PR environments for integration testing | `sandbox-pr-{N}` | Created on PR open, destroyed on PR close |
| **Staging** | Pre-production validation, mirrors prod config | `staging` | Permanent, deployed on every push to main |
| **Production** | Live customer-facing environments | `prod` | Permanent, deployed after staging passes |

### Tier Defaults (`infrastructure/pipeline-defaults.json`)

| Property | Sandbox | Staging | Production |
|----------|---------|---------|------------|
| `observability` | `false` | `true` | `true` |
| `logRetention` (days) | `7` | `30` | `90` |
| `protectedResources` | `false` | `false` | `true` |
| `parallelDeploy` | `true` | `true` | `true` |
| `alarmActions` | `[]` | `[]` | `[]` |

### Hardcoded Fallbacks

If `pipeline-defaults.json` is missing or a property is omitted, these fallbacks apply:

| Property | Fallback |
|----------|----------|
| `observability` | `false` |
| `logRetention` | `14` |
| `protectedResources` | `false` |
| `parallelDeploy` | `true` |
| `alarmActions` | `[]` |
| `account` | `CDK_DEFAULT_ACCOUNT` |
| `region` | `CDK_DEFAULT_REGION` or `us-east-1` |

---

## Deployment Phases

All tiers follow the same phase ordering:

| Phase | Services | Reason |
|-------|----------|--------|
| 1 | `*-hub` (EventBridge buses + SSM params) | Other services need bus ARNs to exist |
| 2 | `*-web`, `*-auth` (Frontend, Cognito) | Auth must exist before BFFs validate tokens |
| 3 | Everything else (BFFs, controllers, adapters) | Depend on hubs and auth |
| 4 | Hub re-deploy (first deploy only) | Cross-domain forwarding rules need all bus ARNs |

### Phase Verification

After each phase, deploy.sh verifies critical SSM parameters exist:

- **Phase 1:** `/nestfolio/{prefix}-{subsystem}/event-hub/busArn` for each hub
- **Phase 2:** `/nestfolio/{prefix}-investor/auth/userPoolId` and `userPoolClientId`
- **Phase 4:** Automatically skipped if all hub params already exist (not a first deploy)

### Inference Rules

| Service Pattern | Phase | Dependencies |
|-----------------|-------|-------------|
| `*-hub` | 1 | none |
| `*-web`, `*-auth` | 2 | `{subsystem}-hub` |
| `*-bff` | 3 | `{subsystem}-hub`, `investor-web` |
| All others (`*-ctrl`, `*-adpt`) | 3 | `{subsystem}-hub` |

---

## Per-Service Overrides

Create `services/{subsystem}/{service}/pipeline.json` **only** when a service deviates from convention.

### When to Create a `pipeline.json`

#### Serial Deployment (disable parallel)

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "parallelDeploy": false
}
```

#### Custom Dependencies (replaces inferred, does not append)

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "dependencies": ["advisory-hub", "investor-hub"]
}
```

#### Override Deployment Phase

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "deploymentPhase": 2
}
```

#### Service-Specific Tier Override

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "staging": { "observability": false }
}
```

#### Custom Log Retention (production only)

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "production": { "logRetention": 365 }
}
```

#### Alarm Actions (production only)

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "production": { "alarmActions": ["arn:aws:sns:us-east-1:111111111111:critical-alerts"] }
}
```

#### Service-Specific Production Targets (multi-region)

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "production": [{ "region": "us-east-1" }]
}
```

### Merge Behavior

| Property | Strategy |
|----------|----------|
| Scalars (`observability`, `logRetention`, etc.) | Last wins |
| `dependencies` | **Replace** (not append) |
| `alarmActions` | **Replace** (not append) |
| `production` as array | Replaces global targets entirely |

### Current Overrides

| Service | Override | Reason |
|---------|----------|--------|
| `investor-web` | `parallelDeploy: false` | Serial deploy (modifies shared Cognito resources) |

All other 15 services are fully inferrable and have no `pipeline.json`.

---

## CI/CD Workflows

### Push to Main → Staging → Production (`deploy.yml`)

```
push to main
  → nx affected (detect changed services)
  → validate pipeline configs
  → deploy to staging:  deploy.sh staging --services="affected"
  → (manual approval)
  → deploy to production: deploy.sh prod --services="affected"
```

### PR → Sandbox (`pr-deploy.yml`)

```
PR opened/reopened
  → deploy.sh sandbox --prefix=sandbox-pr-{N}        (full deploy)

PR synchronized (new commits)
  → deploy.sh sandbox --prefix=sandbox-pr-{N} --services="affected"

PR closed
  → teardown.sh sandbox-pr-{N}
```

### Manual Dispatch (Hotfix)

Use `deploy.yml` → "Run workflow" with `--services=svc1,svc2` to deploy specific services directly.

---

## GitHub OIDC Role Setup

The pipeline uses GitHub Actions OIDC for keyless AWS authentication. A CDK stack provisions the OIDC provider and IAM role.

### Initial Setup (Once Per AWS Account)

#### 1. Bootstrap CDK

```bash
cdk bootstrap aws://{ACCOUNT_ID}/us-east-1
```

#### 2. Deploy the GitHub OIDC Role

```bash
npx cdk deploy \
  --app 'npx ts-node -r ./tools/register-paths.js infrastructure/pipeline/src/github-role.app.ts' \
  -c repo=YOUR_ORG/nestfolio
```

This creates:
- An OIDC identity provider for `token.actions.githubusercontent.com`
- An IAM role `nestfolio-github-actions-role` trusting the specified GitHub repo
- The role has `AdministratorAccess` (scope down for production accounts)

Note the **Role ARN** from the stack output.

#### 3. Configure GitHub Secrets

In GitHub repo **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|-------|
| `AWS_ROLE_ARN` | The role ARN from step 2 |

#### 4. Configure GitHub Environments

In GitHub repo **Settings → Environments**, create:

| Environment | Protection Rules | Secrets |
|-------------|-----------------|---------|
| `sandbox` | None (auto-deploy on PR) | `AWS_ROLE_ARN` |
| `staging` | None (auto-deploy on push to main) | `AWS_ROLE_ARN` |
| `production` | Required reviewers (1+ people) | `AWS_ROLE_ARN` |

Each environment can have its own `AWS_ROLE_ARN` if using separate AWS accounts.

### Multi-Account Production

To add a second production environment (e.g., EU):

#### 1. Bootstrap the new account

```bash
cdk bootstrap aws://{EU_ACCOUNT_ID}/eu-west-1
```

#### 2. Deploy the OIDC role in the new account

```bash
AWS_DEFAULT_REGION=eu-west-1 \
CDK_DEFAULT_ACCOUNT={EU_ACCOUNT_ID} \
npx cdk deploy \
  --app 'npx ts-node -r ./tools/register-paths.js infrastructure/pipeline/src/github-role.app.ts' \
  -c repo=YOUR_ORG/nestfolio
```

#### 3. Create a GitHub environment

Create `prod-eu` in GitHub Settings → Environments with the new role ARN.

#### 4. Update `infrastructure/pipeline-defaults.json`

Convert `production` from object to array:

```json
{
  "production": [
    {
      "account": "111111111111",
      "region": "us-east-1",
      "environment": "production",
      "observability": true,
      "logRetention": 90,
      "protectedResources": true,
      "parallelDeploy": true,
      "alarmActions": []
    },
    {
      "account": "222222222222",
      "region": "eu-west-1",
      "environment": "prod-eu",
      "observability": true,
      "logRetention": 90,
      "protectedResources": true,
      "parallelDeploy": true,
      "alarmActions": ["arn:aws:sns:eu-west-1:222222222222:prod-alerts"]
    }
  ]
}
```

The `environment` field maps to the GitHub Actions environment name for OIDC authentication.

#### 5. Enable the matrix workflow

Uncomment the `production-multi` job in `.github/workflows/deploy.yml`.

### Removing a Production Environment

1. Tear down stacks: `teardown.sh prod` in the target account/region
2. Remove the entry from the `production` array in `pipeline-defaults.json`
3. Delete the GitHub environment
4. If only one target remains, optionally convert `production` back to an object

### Migrating from cdk-pipelines-github

If the `nestfolio-github-role` stack was previously deployed using `cdk-pipelines-github`, destroy the old stack first:

```bash
npx cdk destroy \
  --app 'npx ts-node -r ./tools/register-paths.js infrastructure/pipeline/src/github-role.app.ts' \
  nestfolio-github-role
```

Then re-deploy with the current constructs (see step 2 above).

---

## Troubleshooting

### Dry-Run Shows Unexpected Values

```bash
# Inspect resolved config for a specific service
node --no-warnings infrastructure/scripts/resolve-all-configs.ts staging --prefix=staging \
  | jq '.[] | select(.service == "investor-web")'
```

### "CDK context 'prefix' is required"

The `main.ts` entry points read `prefix` and `tier` from CDK context. When deploying manually outside of `deploy.sh`:

```bash
cdk synth -c prefix=dev -c tier=sandbox
```

### SSM Parameter Not Found After Phase 1

Hub stacks publish bus ARNs to SSM. If verification fails:
1. Check the hub stack deployed successfully in CloudFormation
2. Verify the SSM path matches: `/nestfolio/{prefix}-{subsystem}/event-hub/busArn`
3. Ensure you're checking the correct region

### Pre-Existing Test Failures

The following test failures are pre-existing and unrelated to the pipeline:
- `ledger-bff:test`, `ledger-ctrl:test` — stack tests missing `prefix` prop
- Frontend lib tests (`auth`, `i18n`, `ledger-mfe`) — intermittent jsdom issues

### Validation Fails

```bash
# Run the validation script locally
bash .github/scripts/validate-pipeline-configs.sh
```

This validates both `pipeline-defaults.json` and any per-service `pipeline.json` overrides.

---

## File Reference

| File | Purpose |
|------|---------|
| `infrastructure/pipeline-defaults.json` | Tier-level defaults (single source of truth) |
| `infrastructure/pipeline-defaults-schema.json` | JSON Schema for pipeline-defaults.json |
| `.pipeline-schema.json` | JSON Schema for per-service pipeline.json overrides |
| `infrastructure/scripts/deploy.sh` | Phase-ordered deployment orchestrator |
| `infrastructure/scripts/teardown.sh` | Reverse-order teardown |
| `infrastructure/scripts/resolve-all-configs.ts` | Resolves all 16 services → JSON for deploy.sh |
| `infrastructure/scripts/__snapshots__/*.json` | Golden snapshots (sandbox/staging/production) |
| `libs/cdk-constructs/src/resolve-pipeline-config.ts` | Resolution engine (used by CDK main.ts files) |
| `infrastructure/pipeline/src/github-role.app.ts` | CDK app for GitHub OIDC role |
| `infrastructure/pipeline/src/github-role.stack.ts` | GitHub OIDC role + provider construct |
| `.github/workflows/deploy.yml` | CI: staging + production deployment |
| `.github/workflows/pr-deploy.yml` | CI: sandbox PR deployment |
| `.github/scripts/validate-pipeline-configs.sh` | CI: config validation |
