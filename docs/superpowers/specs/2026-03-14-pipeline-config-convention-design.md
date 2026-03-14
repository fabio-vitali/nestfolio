# Pipeline Configuration Convention-over-Configuration

**Date:** 2026-03-14
**Status:** Draft

## Problem

All 16 services have nearly identical `pipeline.json` files specifying the same account, region, and deployment properties. The current schema doesn't support multi-account or multi-region production deployments. Adding a new environment tier or changing a default requires editing every file.

## Goals

1. **Convention-over-configuration**: most services need zero pipeline.json — metadata is inferred from directory structure and naming
2. **Multi-environment support**: sandbox, staging, and production tiers with distinct properties (observability, log retention, resource protection, etc.)
3. **Multi-account/multi-region production**: production can target multiple `{account, region}` pairs
4. **Intelligent defaults**: a single `infrastructure/pipeline-defaults.json` defines tier-level defaults
5. **Progressive complexity**: day 1 works with a single account (`CDK_DEFAULT_*`); multi-account is opt-in when needed

## Non-Goals

- Cross-region data replication (DynamoDB Global Tables, EventBridge cross-region)
- IAM role provisioning automation (handled separately)
- Frontend CDN / CloudFront multi-origin setup

---

## Architecture

### File Structure

```
nestfolio/
├── infrastructure/
│   ├── pipeline-defaults.json          # Tier-level defaults (source of truth)
│   ├── pipeline-defaults-schema.json   # JSON Schema for pipeline-defaults.json
│   └── scripts/
│       ├── deploy.sh                   # Phase-ordered deployment orchestrator
│       └── resolve-all-configs.ts      # Resolves all service configs for deploy.sh
├── .pipeline-schema.json               # JSON Schema for per-service pipeline.json (updated)
└── services/
    └── {subsystem}/
        └── {service}/
            ├── pipeline.json           # OPTIONAL — only for overrides
            └── src/main.ts             # CDK entry point
```

### Configuration Layers (Resolution Order)

Resolution follows a 3-layer merge strategy. Later layers override earlier ones:

1. **Inferred defaults** — derived from directory structure and naming conventions
2. **Tier defaults** — from `infrastructure/pipeline-defaults.json` for the active tier
3. **Per-service overrides** — from `services/{subsystem}/{service}/pipeline.json` (if present)

### Layer 1: Inference Rules

| Source | Inferred Property | Rule |
|--------|------------------|------|
| `services/{subsystem}/{service}/` | `subsystem` | Parent directory name under `services/` |
| `services/{subsystem}/{service}/` | `service` | Directory name (matches Nx project name) |
| Service name ends with `-hub` | `deploymentPhase: 1` | Hub stacks deploy first (EventBridge buses, SSM params) |
| Service name ends with `-web` or `-auth` | `deploymentPhase: 2` | Frontend and auth stacks deploy after hubs |
| All other services | `deploymentPhase: 3` | BFFs, controllers, adapters deploy last |
| Service name ends with `-bff` | `dependencies: ["{subsystem}-hub", "investor-web"]` | BFFs depend on their hub + auth/frontend (Cognito token validation) |
| Non-hub, non-BFF services | `dependencies: ["{subsystem}-hub"]` | Controllers/adapters depend on their subsystem's hub |
| Hub services | `dependencies: []` | Hubs have no intra-phase dependencies |

**Discovery:** Services are discovered by scanning `services/*/*/src/main.ts` — any directory with a CDK entry point is a deployable service.

**Services that still need a `pipeline.json` override after migration:**

| Service | Reason | Override |
|---------|--------|----------|
| `investor-web` | `parallelDeploy: false` (serial deploy) | `{ "parallelDeploy": false }` |

All other 15 services are fully inferrable and need no `pipeline.json`.

### Layer 2: `infrastructure/pipeline-defaults.json`

Defines default properties per environment tier. All properties are optional — hardcoded fallbacks apply if omitted.

```json
{
  "$schema": "./pipeline-defaults-schema.json",
  "sandbox": {
    "observability": false,
    "logRetention": 7,
    "protectedResources": false,
    "parallelDeploy": true,
    "alarmActions": []
  },
  "staging": {
    "observability": true,
    "logRetention": 30,
    "protectedResources": false,
    "parallelDeploy": true,
    "alarmActions": []
  },
  "production": {
    "observability": true,
    "logRetention": 90,
    "protectedResources": true,
    "parallelDeploy": true,
    "alarmActions": []
  }
}
```

**Hardcoded fallbacks** (when pipeline-defaults.json is absent or a property is omitted):

| Property | Fallback |
|----------|----------|
| `observability` | `false` |
| `logRetention` | `14` |
| `protectedResources` | `false` |
| `parallelDeploy` | `true` |
| `alarmActions` | `[]` |
| `account` | `undefined` (→ `CDK_DEFAULT_ACCOUNT`) |
| `region` | `undefined` (→ `CDK_DEFAULT_REGION` → `us-east-1`) |

**Tier passing:**

The active tier is passed explicitly via CDK context (`-c tier=staging`). `deploy.sh` always passes the tier; `main.ts` reads it via `app.node.tryGetContext('tier')`.

Fallback for local dev (no tier context): infer from prefix pattern:

| Prefix pattern | Tier |
|---------------|------|
| `sandbox-*` | `sandbox` |
| `staging` | `staging` |
| `prod` or `production` | `production` |
| Anything else | `sandbox` (safe default) |

### Layer 3: Per-Service `pipeline.json` (Optional)

Only created when a service deviates from convention. The schema supports any subset of properties.

**Example — serial deploy override:**
```json
{
  "$schema": "../../../.pipeline-schema.json",
  "parallelDeploy": false
}
```

**Example — custom dependencies:**
```json
{
  "$schema": "../../../.pipeline-schema.json",
  "dependencies": ["advisory-hub", "investor-hub"]
}
```

**Example — service-specific production targets:**
```json
{
  "$schema": "../../../.pipeline-schema.json",
  "production": [
    { "region": "us-east-1" },
    { "region": "eu-west-1", "logRetention": 180 }
  ]
}
```

**Example — override deployment phase:**
```json
{
  "$schema": "../../../.pipeline-schema.json",
  "deploymentPhase": 2
}
```

---

## Resolved Configuration Type

The resolution engine outputs a fully resolved config per service per target:

```typescript
interface ResolvedPipelineConfig {
  // Inferred (Layer 1)
  service: string;
  subsystem: string;
  deploymentPhase: 1 | 2 | 3;
  dependencies: string[];

  // Tier defaults + overrides (Layers 2 & 3)
  observability: boolean;
  parallelDeploy: boolean;
  logRetention: number;
  protectedResources: boolean;
  alarmActions: string[];

  // Target (from tier defaults or per-service override)
  account?: string;   // undefined → CDK_DEFAULT_ACCOUNT
  region?: string;    // undefined → CDK_DEFAULT_REGION ?? 'us-east-1'

  // Derived
  prefix: string;     // passed via CDK context or CLI arg
}
```

---

## Resolution Engine: `resolve-pipeline-config.ts`

Located in `libs/cdk-constructs/src/resolve-pipeline-config.ts`.

### Algorithm

```
resolvePipelineConfig(serviceName, tier, prefix):
  1. Infer subsystem, phase, dependencies from service path
  2. Load pipeline-defaults.json → extract tier defaults
  3. Load per-service pipeline.json (if exists)
  4. Deep-merge: inferred → tier defaults → per-service overrides
  5. Return ResolvedPipelineConfig
```

### Merge semantics

- Scalars: last wins
- Arrays (`dependencies`, `alarmActions`): **replace** (not concat) — if a per-service override specifies `dependencies`, it replaces the inferred list entirely
- `production` as array in override: each entry inherits tier defaults, then applies its own overrides

### Consumers

1. **`main.ts`** (CDK entry point): calls `resolvePipelineConfig()` to get account/region + all properties
2. **`resolve-all-configs.ts`** (deploy.sh helper): resolves all services at once, outputs JSON for shell consumption
3. **`validate-pipeline-configs.sh`**: updated to validate pipeline-defaults.json + any per-service overrides

---

## deploy.sh Changes

### New Signature

```bash
deploy.sh <tier> [--prefix=<custom>] [--services=svc1,svc2]
```

- `<tier>`: `sandbox`, `staging`, or `prod`
- `--prefix`: override the default prefix for the tier (e.g., `--prefix=sandbox-pr-42`). Defaults: `sandbox` → `sandbox`, `staging` → `staging`, `prod` → `prod`
- `--services`: filter to specific services (unchanged from current)

### Flow

1. Call `resolve-all-configs.ts <tier> [--prefix=<prefix>]` → JSON array of all resolved configs
2. Group by `deploymentPhase` (1, 2, 3)
3. For each phase:
   - **Multi-target production**: iterate each `{account, region}` target, deploying all services in that phase to that target (parallel/serial as configured)
   - **Single-target (sandbox/staging or single-prod)**: deploy with `CDK_DEFAULT_ACCOUNT`/`CDK_DEFAULT_REGION` as today
4. Pass resolved properties as CDK context: `-c tier=prod -c prefix=prod -c observability=true -c logRetention=90 -c protectedResources=true`
5. Phase verification unchanged:
   - **Phase 1**: verify hub bus ARN SSM params exist (per-subsystem, per-region)
   - **Phase 2**: verify auth SSM params (`userPoolId`, `userPoolClientId`) — these remain hardcoded checks since only `investor-web` publishes auth params

### Backwards compatibility

- `deploy.sh staging` works identically to `deploy.sh staging --prefix=staging`
- `deploy.sh sandbox --prefix=sandbox-pr-42` replaces `deploy.sh sandbox-pr-42`

---

## CDK Stack Integration

### main.ts (all 16 services)

Before:
```typescript
const app = new App();
const prefix = getPrefix(app);
new AdvisoryCtrlStack(app, `${prefix}-advisory-ctrl`, {
  prefix,
  env: {
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});
```

After:
```typescript
const app = new App();
// resolvePipelineConfig reads 'tier' and 'prefix' from CDK context,
// infers subsystem/phase from service path, merges tier defaults + overrides
const config = resolvePipelineConfig(app, 'advisory-ctrl');
new AdvisoryCtrlStack(app, `${config.prefix}-advisory-ctrl`, {
  ...config,
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});
```

`deploy.sh` passes tier via: `cdk deploy -c tier=staging -c prefix=staging ...`

### Stack props extension

Stacks already receive `prefix` and read `observability` from CDK context. The new config adds:

- `logRetention` → passed to `defaultLambdaProps` (replaces hardcoded `RetentionDays.THREE_MONTHS`)
- `protectedResources` → controls `RemovalPolicy` on DynamoDB tables, S3 buckets
- `alarmActions` → passed to `Monitoring` and `ServiceDashboard` constructs

---

## GitHub Actions Changes

### deploy.yml

**Staging job:** unchanged — single target, `CDK_DEFAULT_*`

**Production job:** reads resolved production targets for matrix strategy:

```yaml
production:
  needs: staging
  if: needs.staging.outputs.skipped == 'false'
  strategy:
    matrix:
      target: ${{ fromJson(needs.staging.outputs.prod_targets) }}
  runs-on: ubuntu-latest
  environment: ${{ matrix.target.environment }}
  steps:
    - uses: aws-actions/configure-aws-credentials@v4
      with:
        role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
        aws-region: ${{ matrix.target.region }}
    - run: |
        export CDK_DEFAULT_ACCOUNT=${{ matrix.target.account }}
        export CDK_DEFAULT_REGION=${{ matrix.target.region }}
        bash infrastructure/scripts/deploy.sh prod --services="${{ needs.staging.outputs.affected }}"
```

Day 1 (single account): matrix has one entry `[{ environment: "production", region: "us-east-1" }]`, `CDK_DEFAULT_ACCOUNT` comes from OIDC caller identity. Behaves exactly like today.

### pr-deploy.yml

Minimal change: `deploy.sh "$PREFIX_SANDBOX"` → `deploy.sh sandbox --prefix="$PREFIX_SANDBOX"`

---

## Deployment Strategy

### Environment Tiers

| Tier | Purpose | Prefix | Lifecycle |
|------|---------|--------|-----------|
| **Sandbox** | Ephemeral PR environments for integration testing | `sandbox-pr-{N}` | Created on PR open, destroyed on PR close |
| **Staging** | Pre-production validation, mirrors prod config | `staging` | Permanent, deployed on every push to main |
| **Production** | Live customer-facing environments | `prod` | Permanent, deployed after staging passes, protected by GH environment approvals |

### Deployment Phases

All tiers follow the same phase ordering:

| Phase | Services | Why |
|-------|----------|-----|
| 1 | `*-hub` (EventBridge buses + SSM params) | Other services need bus ARNs to exist |
| 2 | `*-web`, `*-auth` (Frontend, Cognito) | Auth must exist before BFFs validate tokens |
| 3 | Everything else (BFFs, controllers, adapters) | Depend on hubs and auth |
| 4 | Hub re-deploy (first deploy only) | Cross-domain forwarding rules need all bus ARNs |

### Multi-Target Production Deployment

When production has multiple targets, deploy.sh deploys **all phases to target 1, then all phases to target 2**, etc. This ensures each target is self-consistent before moving to the next.

```
Target 1 (us-east-1): Phase 1 → Phase 2 → Phase 3 → Phase 4
Target 2 (eu-west-1): Phase 1 → Phase 2 → Phase 3 → Phase 4
```

### Rollback Strategy

- **Sandbox**: destroy and recreate (`teardown.sh` already exists)
- **Staging**: re-deploy previous commit (GH Actions re-run)
- **Production**: CDK does not auto-rollback; failed deploys leave the stack in `UPDATE_ROLLBACK_COMPLETE`. Fix forward or manually rollback via CloudFormation console. `protectedResources: true` prevents accidental data loss.

---

## Per-Service Configuration Override Guide

### When to Create a `pipeline.json`

Create `services/{subsystem}/{service}/pipeline.json` **only** when a service deviates from convention. Common scenarios:

#### 1. Serial Deployment (disable parallel)

Some services must deploy sequentially (e.g., they modify shared resources):

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "parallelDeploy": false
}
```

#### 2. Custom Dependencies

A service depends on a hub from a different subsystem:

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "dependencies": ["advisory-hub", "investor-hub"]
}
```

**Note:** This **replaces** the inferred dependency, not appends. Include the service's own hub if still needed.

#### 3. Override Deployment Phase

A BFF that must deploy in phase 2 (e.g., it sets up auth-related resources):

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "deploymentPhase": 2
}
```

#### 4. Service-Specific Observability

Disable observability for a low-traffic service in staging:

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "staging": {
    "observability": false
  }
}
```

#### 5. Service-Specific Production Targets

Deploy only to a subset of production targets:

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "production": [
    { "region": "us-east-1" }
  ]
}
```

#### 6. Custom Log Retention

A compliance service that must retain logs for 1 year:

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "production": {
    "logRetention": 365
  }
}
```

#### 7. Alarm Actions

Route alarms for a critical service to a specific SNS topic:

```json
{
  "$schema": "../../../.pipeline-schema.json",
  "production": {
    "alarmActions": ["arn:aws:sns:us-east-1:111111111111:critical-alerts"]
  }
}
```

### Override Merge Behavior

| Property | Merge Strategy |
|----------|---------------|
| Scalars (`observability`, `logRetention`, `parallelDeploy`, `protectedResources`, `deploymentPhase`) | Last wins |
| `dependencies` | **Replace** (not append) |
| `alarmActions` | **Replace** (not append) |
| `production` (when array in override) | Each entry inherits tier defaults, then applies its own scalar overrides |

### Production Override Semantics: Object vs Array

The `production` field in a per-service `pipeline.json` can be either an **object** or an **array**:

- **Object** (`tierOverride`): applies scalar overrides to **all** production targets defined in `pipeline-defaults.json`. Use this when you want to change a property (e.g., `logRetention`) across all targets. The object form has no `account`/`region` — it inherits targets from the global defaults.

  ```json
  { "production": { "logRetention": 365 } }
  ```

- **Array** (`targetOverride[]`): **replaces** the global production targets entirely. Use this when a service should deploy to a subset of targets or needs per-target overrides. Each entry can specify `account`/`region` to select specific targets; entries without `account`/`region` inherit from `CDK_DEFAULT_*`.

  ```json
  { "production": [{ "region": "us-east-1" }] }
  ```

---

## Adding a New Production Environment

### Step-by-step Guide

#### 1. Provision AWS Account

Set up the new AWS account with:
- OIDC identity provider for GitHub Actions (trust policy for your repo)
- A deploy role (`nestfolio-deploy`) with CDK bootstrap permissions
- CDK bootstrap (`cdk bootstrap aws://{account}/{region}`)

#### 2. Add GitHub Environment

In GitHub repo Settings → Environments:
- Create environment (e.g., `prod-eu`)
- Add secret `AWS_ROLE_ARN` = the deploy role ARN from step 1
- Configure protection rules (required reviewers, wait timer, etc.)

#### 3. Update `infrastructure/pipeline-defaults.json`

Change `production` from object to array:

```json
{
  "production": [
    {
      "account": "111111111111",
      "region": "us-east-1",
      "observability": true,
      "logRetention": 90,
      "protectedResources": true,
      "parallelDeploy": true,
      "alarmActions": []
    },
    {
      "account": "222222222222",
      "region": "eu-west-1",
      "observability": true,
      "logRetention": 90,
      "protectedResources": true,
      "parallelDeploy": true,
      "alarmActions": ["arn:aws:sns:eu-west-1:222222222222:prod-alerts"]
    }
  ]
}
```

**Note:** When converting from object to array, move all existing properties into each array entry (or factor them into a shared base that each entry spreads from — this is a code-level concern in `resolve-pipeline-config.ts`, not a schema feature).

#### 4. Update GitHub Actions Workflow

The production job's matrix automatically picks up the new target from `resolve-all-configs.ts` output. You may need to:
- Map the new target to its GH environment name (e.g., `prod-eu`)
- Ensure the workflow matrix includes `environment: prod-eu`

#### 5. Deploy

Push to main. The staging job runs as usual. The production job now has two matrix entries — one per target. Each uses its own GH environment for OIDC auth.

#### 6. Verify

- Check CloudFormation stacks in both accounts/regions
- Verify SSM parameters exist in both regions
- Verify EventBridge rules and cross-domain forwarding

### Removing a Production Environment

1. Tear down stacks in the target account (`teardown.sh` or manual CloudFormation delete)
2. Remove the entry from `production` array in `pipeline-defaults.json`
3. Remove the GitHub environment
4. If only one target remains, optionally convert `production` back to an object

---

## Schemas

### `infrastructure/pipeline-defaults-schema.json`

Validates the global tier defaults file:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Nestfolio Pipeline Defaults",
  "type": "object",
  "properties": {
    "$schema": { "type": "string" },
    "sandbox": { "$ref": "#/$defs/tierDefaults" },
    "staging": { "$ref": "#/$defs/tierDefaults" },
    "production": {
      "oneOf": [
        { "$ref": "#/$defs/tierDefaults" },
        { "type": "array", "items": { "$ref": "#/$defs/targetDefaults" }, "minItems": 1 }
      ]
    }
  },
  "additionalProperties": false,
  "$defs": {
    "tierDefaults": {
      "type": "object",
      "properties": {
        "account": { "type": "string", "pattern": "^[0-9]{12}$" },
        "region": { "type": "string" },
        "environment": { "type": "string", "description": "GitHub Actions environment name for OIDC auth" },
        "observability": { "type": "boolean" },
        "parallelDeploy": { "type": "boolean" },
        "logRetention": { "type": "integer", "minimum": 1 },
        "protectedResources": { "type": "boolean" },
        "alarmActions": { "type": "array", "items": { "type": "string" } }
      },
      "additionalProperties": false
    },
    "targetDefaults": {
      "type": "object",
      "required": ["account", "region", "environment"],
      "properties": {
        "account": { "type": "string", "pattern": "^[0-9]{12}$" },
        "region": { "type": "string" },
        "environment": { "type": "string", "description": "GitHub Actions environment name for OIDC auth" },
        "observability": { "type": "boolean" },
        "parallelDeploy": { "type": "boolean" },
        "logRetention": { "type": "integer", "minimum": 1 },
        "protectedResources": { "type": "boolean" },
        "alarmActions": { "type": "array", "items": { "type": "string" } }
      },
      "additionalProperties": false
    }
  }
}
```

When `production` is an array of targets, each entry **must** specify `account`, `region`, and `environment` (the GitHub Actions environment name used for OIDC auth — e.g., `"prod-us"`, `"prod-eu"`). This `environment` field is the bridge between the repo config and GitHub's auth model: `resolve-all-configs.ts` includes it in its output, and the workflow uses it as `${{ matrix.target.environment }}`.

### `.pipeline-schema.json` (per-service overrides)

The per-service schema becomes permissive — all fields optional since everything has defaults:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Nestfolio Per-Service Pipeline Override",
  "type": "object",
  "properties": {
    "$schema": { "type": "string" },
    "deploymentPhase": {
      "type": "integer", "minimum": 1, "maximum": 3
    },
    "parallelDeploy": { "type": "boolean" },
    "dependencies": {
      "type": "array", "items": { "type": "string" }
    },
    "observability": { "type": "boolean" },
    "logRetention": { "type": "integer", "minimum": 1 },
    "protectedResources": { "type": "boolean" },
    "alarmActions": {
      "type": "array", "items": { "type": "string" }
    },
    "sandbox": { "$ref": "#/$defs/tierOverride" },
    "staging": { "$ref": "#/$defs/tierOverride" },
    "production": {
      "oneOf": [
        { "$ref": "#/$defs/tierOverride" },
        { "type": "array", "items": { "$ref": "#/$defs/targetOverride" } }
      ]
    }
  },
  "additionalProperties": false,
  "$defs": {
    "tierOverride": {
      "type": "object",
      "properties": {
        "account": { "type": "string", "pattern": "^[0-9]{12}$" },
        "region": { "type": "string" },
        "environment": { "type": "string" },
        "observability": { "type": "boolean" },
        "parallelDeploy": { "type": "boolean" },
        "logRetention": { "type": "integer", "minimum": 1 },
        "protectedResources": { "type": "boolean" },
        "alarmActions": { "type": "array", "items": { "type": "string" } }
      },
      "additionalProperties": false
    },
    "targetOverride": {
      "type": "object",
      "properties": {
        "account": { "type": "string", "pattern": "^[0-9]{12}$" },
        "region": { "type": "string" },
        "environment": { "type": "string" },
        "observability": { "type": "boolean" },
        "parallelDeploy": { "type": "boolean" },
        "logRetention": { "type": "integer", "minimum": 1 },
        "protectedResources": { "type": "boolean" },
        "alarmActions": { "type": "array", "items": { "type": "string" } }
      },
      "additionalProperties": false
    }
  }
}
```

---

## Testing Strategy

1. **Unit tests for `resolve-pipeline-config.ts`**: test inference rules, merge logic, tier detection, edge cases (missing files, partial overrides, production array expansion)
2. **Validation script tests**: ensure schema rejects invalid configs
3. **Snapshot test for `resolve-all-configs.ts`**: resolve all 16 services for each tier, compare against a golden JSON file — provides a safety net during migration
4. **deploy.sh dry-run**: add `--dry-run` flag that prints resolved configs and deployment plan without executing

### `resolve-all-configs.ts` Output Shape

The resolver outputs a JSON array consumed by `deploy.sh`:

```json
[
  {
    "service": "investor-hub",
    "subsystem": "investor",
    "deploymentPhase": 1,
    "dependencies": [],
    "observability": true,
    "parallelDeploy": true,
    "logRetention": 90,
    "protectedResources": true,
    "alarmActions": [],
    "prefix": "prod"
  },
  {
    "service": "advisory-ctrl",
    "subsystem": "advisory",
    "deploymentPhase": 3,
    "dependencies": ["advisory-hub"],
    "observability": true,
    "parallelDeploy": true,
    "logRetention": 90,
    "protectedResources": true,
    "alarmActions": [],
    "prefix": "prod"
  }
]
```

When production has multiple targets, each service appears once per target with `account` and `region` populated. The `environment` field (GitHub Actions environment name) is included when defined in `pipeline-defaults.json`.

---

## Migration Plan (High-Level)

1. Create `infrastructure/pipeline-defaults.json` + `pipeline-defaults-schema.json`
2. Implement `resolve-pipeline-config.ts` in `libs/cdk-constructs` with unit tests
3. Create `infrastructure/scripts/resolve-all-configs.ts` + snapshot golden files
4. Update `.pipeline-schema.json` to new permissive schema
5. Update `deploy.sh` to use resolver (new signature, CDK context passing including `-c tier=`)
6. Update all 16 `main.ts` files to use `resolvePipelineConfig()`
7. Delete 15 of 16 `pipeline.json` files; replace `investor-web/pipeline.json` with minimal override (`{ "parallelDeploy": false }`)
8. Update `validate-pipeline-configs.sh` to validate both `pipeline-defaults.json` and per-service overrides
9. Update GitHub Actions workflows (`deploy.yml`, `pr-deploy.yml`)
10. Add `--dry-run` flag to deploy.sh
11. End-to-end validation: `deploy.sh staging --dry-run`
