# Pipeline & Stage Migration Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce CDK `ServiceStage` construct, migrate to `cdk-pipelines-github` for CI/CD, add production deployment with manual approval, rewrite deploy scripts to be dynamic (pipeline.json-driven), and support per-environment observability toggling.

**Architecture:** Each service gets a `ServiceStage` (CDK `Stage`) wrapping its stack. A CDK `GitHubWorkflow` pipeline defines staging (main push) and production (manual approval via GitHub Environment protection rules). PR sandbox stays as a hand-written workflow calling `deploy-all.sh`. `deploy-all.sh` and `destroy-all.sh` are rewritten to read `pipeline.json` dynamically. Observability (Monitoring + ServiceDashboard) is togglable per-environment via a boolean flag.

**Tech Stack:** `cdk-pipelines-github`, CDK `Stage`, GitHub Environment protection rules, OIDC, `pipeline.json` metadata, bash/jq.

**Key decisions:**
- `deploy-all.sh` stays as direct stack deploys (not Stage) — CDK Stage is for CI only
- `pipeline.json` is the source of truth for deployment ordering
- GitHub Environment protection rules for manual prod approval
- `cdk-pipelines-github` generates `deploy.yml` (replaces `main-deploy.yml`)
- PR sandbox stays hand-written (PR number is dynamic, not known at synth time)
- Single AWS account initially, architecture supports multi-account
- Observability is per-environment: configurable via `--observability` flag (manual) or stage props (pipeline)

---

## Chunk 1: Foundation — Schema, Missing Configs, Observability Toggle, Dynamic Scripts

### Task 1: Update pipeline schema for ledger subsystem

**Files:**
- Modify: `.pipeline-schema.json:17`

- [ ] **Step 1: Add `"ledger"` to the subsystem enum**

```json
"enum": ["investor", "advisory", "execution", "ledger"]
```

- [ ] **Step 2: Verify schema is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('.pipeline-schema.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add .pipeline-schema.json
git commit -m "chore: add ledger subsystem to pipeline schema"
```

---

### Task 2: Create missing pipeline.json files (5 services)

**Files:**
- Create: `services/advisory/advisory-bff/pipeline.json`
- Create: `services/investor/investor-ctrl/pipeline.json`
- Create: `services/ledger/ledger-hub/pipeline.json`
- Create: `services/ledger/ledger-ctrl/pipeline.json`
- Create: `services/ledger/ledger-bff/pipeline.json`

- [ ] **Step 1: Create all 5 files**

`services/advisory/advisory-bff/pipeline.json`:
```json
{
  "$schema": "../../../.pipeline-schema.json",
  "service": "advisory-bff",
  "subsystem": "advisory",
  "deploymentPhase": 3,
  "production": { "regions": ["us-east-1"], "parallelDeploy": true },
  "dependencies": ["advisory-hub", "investor-web"]
}
```

`services/investor/investor-ctrl/pipeline.json`:
```json
{
  "$schema": "../../../.pipeline-schema.json",
  "service": "investor-ctrl",
  "subsystem": "investor",
  "deploymentPhase": 3,
  "production": { "regions": ["us-east-1"], "parallelDeploy": true },
  "dependencies": ["investor-hub"]
}
```

`services/ledger/ledger-hub/pipeline.json`:
```json
{
  "$schema": "../../../.pipeline-schema.json",
  "service": "ledger-hub",
  "subsystem": "ledger",
  "deploymentPhase": 1,
  "production": { "regions": ["us-east-1"], "parallelDeploy": true },
  "dependencies": []
}
```

`services/ledger/ledger-ctrl/pipeline.json`:
```json
{
  "$schema": "../../../.pipeline-schema.json",
  "service": "ledger-ctrl",
  "subsystem": "ledger",
  "deploymentPhase": 3,
  "production": { "regions": ["us-east-1"], "parallelDeploy": true },
  "dependencies": ["ledger-hub"]
}
```

`services/ledger/ledger-bff/pipeline.json` (Nx project name is `ledger-bff`):
```json
{
  "$schema": "../../../.pipeline-schema.json",
  "service": "ledger-bff",
  "subsystem": "ledger",
  "deploymentPhase": 3,
  "production": { "regions": ["us-east-1"], "parallelDeploy": true },
  "dependencies": ["ledger-hub", "investor-web"]
}
```

- [ ] **Step 2: Fix validation script depth limit**

In `.github/scripts/validate-pipeline-configs.sh`, update the `find` command to avoid matching worktree duplicates:

```bash
# Before:
PIPELINE_FILES=$(find services -name "pipeline.json" -type f 2>/dev/null)
# After:
PIPELINE_FILES=$(find services -maxdepth 3 -name "pipeline.json" -not -path "*/.*" -type f 2>/dev/null)
```

- [ ] **Step 3: Validate all 16 pipeline.json files**

Run: `bash .github/scripts/validate-pipeline-configs.sh`
Expected: `All pipeline.json files are valid.`

- [ ] **Step 4: Commit**

```bash
git add services/advisory/advisory-bff/pipeline.json \
       services/investor/investor-ctrl/pipeline.json \
       services/ledger/ledger-hub/pipeline.json \
       services/ledger/ledger-ctrl/pipeline.json \
       services/ledger/ledger-bff/pipeline.json \
       .github/scripts/validate-pipeline-configs.sh
git commit -m "chore: add missing pipeline.json for 5 services, fix validation depth"
```

---

### Task 3: Add per-environment observability toggle to ServiceStack

**Files:**
- Modify: `libs/cdk-constructs/src/service-stack.ts`
- Modify: `libs/cdk-constructs/test/service-stack.test.ts`

Currently `addObservability()` always creates Monitoring + ServiceDashboard. Add a guard so it becomes a no-op when observability is disabled.

- [ ] **Step 1: Write the failing test**

Add to `libs/cdk-constructs/test/service-stack.test.ts`:

```typescript
it('addObservability is a no-op when observability is false', () => {
  const stack = createStack({ observability: false });
  // Should not throw
  stack.addObservability({});
  const template = Template.fromStack(stack);
  // No alarms or dashboards created
  template.resourceCountIs('AWS::CloudWatch::Alarm', 0);
  template.resourceCountIs('AWS::CloudWatch::Dashboard', 0);
});

it('addObservability creates resources when observability is true (default)', () => {
  const stack = createStack();
  stack.addObservability({});
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx run cdk-constructs:test -- --testPathPattern=service-stack`
Expected: FAIL (observability prop doesn't exist)

- [ ] **Step 3: Add `observability` prop to ServiceStackProps and guard addObservability**

In `libs/cdk-constructs/src/service-stack.ts`:

Add to `ServiceStackProps`:
```typescript
/** Enable observability (Monitoring + Dashboard). Defaults to true. */
observability?: boolean;
```

Add field to class:
```typescript
readonly observability: boolean;
```

In constructor:
```typescript
this.observability = props.observability ?? true;
```

Guard `addObservability()`:
```typescript
addObservability(opts: { ... }): void {
  if (!this.observability) return;
  // ... existing code ...
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx run cdk-constructs:test -- --testPathPattern=service-stack`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/service-stack.ts \
       libs/cdk-constructs/test/service-stack.test.ts
git commit -m "feat(cdk-constructs): add observability toggle to ServiceStack"
```

---

### Task 4: Add observability toggle to hub stacks

**Files:**
- Modify: `services/investor/investor-hub/src/service.stack.ts`
- Modify: `services/advisory/advisory-hub/src/service.stack.ts`
- Modify: `services/execution/execution-hub/src/service.stack.ts`
- Modify: `services/ledger/ledger-hub/src/service.stack.ts`
Hub stacks extend `Stack` directly (not `ServiceStack`), and create Monitoring + ServiceDashboard inline. Add a context-based toggle: read `observability` from CDK context, defaulting to `true`.

Note: investor-web has no Monitoring/ServiceDashboard constructs, so no changes needed there.

- [ ] **Step 1: Add observability guard to each hub stack**

In each hub stack constructor, after `const prefix = getPrefix(this);`, add:

```typescript
const observability = this.node.tryGetContext('observability') !== 'false';
```

Then wrap the Monitoring and ServiceDashboard blocks:

```typescript
if (observability) {
  new Monitoring(this, 'Monitoring', { ... });
  new ServiceDashboard(this, 'Dashboard', { ... });
}
```

Apply to all 4 hub stacks (investor-hub, advisory-hub, execution-hub, ledger-hub).

- [ ] **Step 2: Update deploy-all.sh (Task 5) and main.ts files to support `--observability` flag**

The deploy scripts pass `-c observability=true|false` to CDK. See Task 5.

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-hub/src/service.stack.ts \
       services/advisory/advisory-hub/src/service.stack.ts \
       services/execution/execution-hub/src/service.stack.ts \
       services/ledger/ledger-hub/src/service.stack.ts
git commit -m "feat: add observability toggle to hub stacks via CDK context"
```

---

### Task 5: Rewrite deploy-all.sh to be pipeline.json-driven

**Files:**
- Modify: `deploy-all.sh` (full rewrite)

Key improvements over the old script:
- Reads services from `pipeline.json` dynamically (no hardcoded names)
- Supports `--observability` flag (defaults to true)
- Adds hub re-deploy phase after all services (preserves current phase 6 behavior)
- Uses `find -maxdepth 3` to avoid false matches

- [ ] **Step 1: Rewrite deploy-all.sh**

```bash
#!/usr/bin/env bash
# deploy-all.sh — Dynamic phase-ordered deployment driven by pipeline.json
set -euo pipefail

PREFIX=${1:?Usage: deploy-all.sh <prefix> [--no-observability]}

# Parse optional flags
OBSERVABILITY="true"
shift
for arg in "$@"; do
  case "$arg" in
    --no-observability) OBSERVABILITY="false" ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# Determine approval mode: skip approval in CI, require locally
APPROVAL_FLAG=""
if [ -n "${CI:-}" ]; then
  APPROVAL_FLAG="--require-approval never"
fi

trap 'echo "ERROR: Deployment failed. Prefix: $PREFIX — manual cleanup may be required." >&2' ERR

verify_ssm_param() {
  local param_name="$1"
  if ! aws ssm get-parameter --name "$param_name" --query 'Parameter.Value' --output text > /dev/null 2>&1; then
    echo "ERROR: SSM parameter $param_name not found after deployment." >&2
    exit 1
  fi
}

deploy_service() {
  local svc="$1"
  echo "  Deploying $svc..."
  pnpm nx run "$svc:deploy" -- --prefix="$PREFIX" $APPROVAL_FLAG -c observability="$OBSERVABILITY"
}

# Discover all services from pipeline.json files
PIPELINE_FILES=$(find services -maxdepth 3 -name "pipeline.json" -not -path "*/node_modules/*" -type f)

if [ -z "$PIPELINE_FILES" ]; then
  echo "ERROR: No pipeline.json files found." >&2
  exit 1
fi

echo "Observability: $OBSERVABILITY"

# Collect hub services for re-deploy phase
HUB_SERVICES=""

# Deploy by phase (1, 2, 3)
for PHASE in 1 2 3; do
  PARALLEL_SERVICES=""
  SERIAL_SERVICES=""

  for FILE in $PIPELINE_FILES; do
    FILE_PHASE=$(jq -r '.deploymentPhase' "$FILE")
    if [ "$FILE_PHASE" = "$PHASE" ]; then
      SVC=$(jq -r '.service' "$FILE")
      PARALLEL=$(jq -r '.production.parallelDeploy' "$FILE")

      if [ "$PHASE" = "1" ]; then
        HUB_SERVICES="$HUB_SERVICES $SVC"
      fi

      if [ "$PARALLEL" = "true" ]; then
        PARALLEL_SERVICES="$PARALLEL_SERVICES $SVC"
      else
        SERIAL_SERVICES="$SERIAL_SERVICES $SVC"
      fi
    fi
  done

  if [ -z "$PARALLEL_SERVICES$SERIAL_SERVICES" ]; then
    continue
  fi

  echo ""
  echo "Phase $PHASE:$SERIAL_SERVICES$PARALLEL_SERVICES"

  # Deploy serial services first
  for SVC in $SERIAL_SERVICES; do
    deploy_service "$SVC"
  done

  # Deploy parallel services concurrently
  PIDS=""
  for SVC in $PARALLEL_SERVICES; do
    deploy_service "$SVC" &
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
        verify_ssm_param "/nestfolio/${PREFIX}-${SUBSYSTEM}/event-hub/busArn"
      fi
    done
  fi

  if [ "$PHASE" = "2" ]; then
    echo "Verifying Phase 2 SSM parameters..."
    verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolId"
    verify_ssm_param "/nestfolio/${PREFIX}-investor/auth/userPoolClientId"
  fi
done

# Re-deploy hubs so cross-domain forwarding rules resolve
if [ -n "$HUB_SERVICES" ]; then
  echo ""
  echo "Phase 4 (hub re-deploy):$HUB_SERVICES"
  PIDS=""
  for SVC in $HUB_SERVICES; do
    deploy_service "$SVC" &
    PIDS="$PIDS $!"
  done
  FAIL=0
  for PID in $PIDS; do
    wait "$PID" || FAIL=1
  done
  if [ "$FAIL" -ne 0 ]; then echo "ERROR: One or more hub re-deploys failed." >&2; exit 1; fi
fi

echo ""
echo "Deployment complete for prefix: $PREFIX"
```

- [ ] **Step 2: Verify script syntax**

Run: `bash -n deploy-all.sh`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add deploy-all.sh
git commit -m "refactor: rewrite deploy-all.sh — pipeline.json-driven, observability flag, hub re-deploy"
```

---

### Task 6: Rewrite destroy-all.sh to be pipeline.json-driven

**Files:**
- Modify: `destroy-all.sh` (full rewrite)

- [ ] **Step 1: Rewrite destroy-all.sh**

```bash
#!/usr/bin/env bash
# destroy-all.sh — Dynamic reverse-order teardown driven by pipeline.json
set -euo pipefail

PREFIX=${1:?Usage: destroy-all.sh <prefix>}

APPROVAL_FLAG=""
if [ -n "${CI:-}" ]; then
  APPROVAL_FLAG="--force"
fi

trap 'echo "ERROR: Teardown failed. Prefix: $PREFIX — manual cleanup may be required." >&2' ERR

destroy_service() {
  local svc="$1"
  echo "  Destroying $svc..."
  pnpm nx run "$svc:destroy" --prefix="$PREFIX" $APPROVAL_FLAG
}

# Discover all services from pipeline.json files
PIPELINE_FILES=$(find services -maxdepth 3 -name "pipeline.json" -not -path "*/node_modules/*" -type f)

if [ -z "$PIPELINE_FILES" ]; then
  echo "ERROR: No pipeline.json files found." >&2
  exit 1
fi

# Teardown in reverse phase order (3, 2, 1)
for PHASE in 3 2 1; do
  PARALLEL_SERVICES=""
  SERIAL_SERVICES=""

  for FILE in $PIPELINE_FILES; do
    FILE_PHASE=$(jq -r '.deploymentPhase' "$FILE")
    if [ "$FILE_PHASE" = "$PHASE" ]; then
      SVC=$(jq -r '.service' "$FILE")
      PARALLEL=$(jq -r '.production.parallelDeploy' "$FILE")
      if [ "$PARALLEL" = "true" ]; then
        PARALLEL_SERVICES="$PARALLEL_SERVICES $SVC"
      else
        SERIAL_SERVICES="$SERIAL_SERVICES $SVC"
      fi
    fi
  done

  if [ -z "$PARALLEL_SERVICES$SERIAL_SERVICES" ]; then
    continue
  fi

  echo ""
  echo "Phase $PHASE (teardown):$SERIAL_SERVICES$PARALLEL_SERVICES"

  # Destroy parallel services concurrently
  for SVC in $PARALLEL_SERVICES; do
    destroy_service "$SVC" &
  done
  wait

  # Destroy serial services
  for SVC in $SERIAL_SERVICES; do
    destroy_service "$SVC"
  done
done

echo ""
echo "Teardown complete for prefix: $PREFIX"
```

- [ ] **Step 2: Verify script syntax**

Run: `bash -n destroy-all.sh`
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add destroy-all.sh
git commit -m "refactor: rewrite destroy-all.sh — pipeline.json-driven"
```

---

## Chunk 2: ServiceStage Construct

### Task 7: Create ServiceStage construct with tests

**Files:**
- Create: `libs/cdk-constructs/src/service-stage.ts`
- Create: `libs/cdk-constructs/test/service-stage.test.ts`
- Modify: `libs/cdk-constructs/src/index.ts`

`ServiceStage` wraps a stack inside a CDK `Stage`. It exposes `prefix`, `production`, and `observability` as readonly properties. The `stackFactory` receives these values as a `StageContext` argument so stacks get their config via direct props — no tree-walking needed.

- [ ] **Step 1: Write the tests**

Create `libs/cdk-constructs/test/service-stage.test.ts`:

```typescript
import { App } from 'aws-cdk-lib';
import * as os from 'os';
import { ServiceStage, ServiceStageProps, StageContext } from '../src/service-stage';
import { ServiceStack } from '../src/service-stack';
import { Construct } from 'constructs';

function createTestStack(scope: Construct, ctx: StageContext) {
  return new ServiceStack(scope, 'TestStack', {
    prefix: ctx.prefix,
    subsystem: 'investor',
    service: 'investor-bff',
    serviceDir: os.tmpdir(),
    terminationProtection: ctx.production,
    observability: ctx.observability,
  });
}

function createStage(overrides: Partial<ServiceStageProps> = {}) {
  const app = new App();
  return new ServiceStage(app, 'TestStage', {
    prefix: 'test',
    production: false,
    observability: true,
    env: { account: '123456789012', region: 'us-east-1' },
    stackFactory: (scope, ctx) => createTestStack(scope, ctx),
    ...overrides,
  });
}

describe('ServiceStage', () => {
  it('creates stage with prefix', () => {
    const stage = createStage();
    expect(stage.prefix).toBe('test');
  });

  it('exposes production flag', () => {
    const stage = createStage({ production: true });
    expect(stage.production).toBe(true);
  });

  it('exposes observability flag', () => {
    const stage = createStage({ observability: false });
    expect(stage.observability).toBe(false);
  });

  it('defaults observability to true', () => {
    const app = new App();
    const stage = new ServiceStage(app, 'S', {
      prefix: 'test',
      production: false,
      env: { account: '123456789012', region: 'us-east-1' },
      stackFactory: () => {},
    });
    expect(stage.observability).toBe(true);
  });

  it('sets terminationProtection when production is true', () => {
    const stage = createStage({ production: true });
    const assembly = stage.synth();
    const stackArtifact = assembly.stacks[0];
    expect(stackArtifact.terminationProtection).toBe(true);
  });

  it('creates the stack via stackFactory', () => {
    const stage = createStage();
    const assembly = stage.synth();
    expect(assembly.stacks).toHaveLength(1);
    expect(assembly.stacks[0].stackName).toBe('TestStack');
  });

  it('passes StageContext to stackFactory', () => {
    let capturedCtx: StageContext | undefined;
    const app = new App();
    new ServiceStage(app, 'S', {
      prefix: 'staging',
      production: true,
      observability: false,
      env: { account: '123456789012', region: 'us-east-1' },
      stackFactory: (_scope, ctx) => { capturedCtx = ctx; },
    });
    expect(capturedCtx).toEqual({
      prefix: 'staging',
      production: true,
      observability: false,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx run cdk-constructs:test -- --testPathPattern=service-stage`
Expected: FAIL — cannot find module `../src/service-stage`

- [ ] **Step 3: Create the ServiceStage construct**

Create `libs/cdk-constructs/src/service-stage.ts`:

```typescript
import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

/** Values passed to stackFactory so stacks receive config via direct props */
export interface StageContext {
  prefix: string;
  production: boolean;
  observability: boolean;
}

export interface ServiceStageProps extends StageProps {
  /** Environment prefix (e.g. 'dev', 'staging', 'prod', 'sandbox-pr-42') */
  prefix: string;
  /** Whether this is a production deployment (enables termination protection) */
  production: boolean;
  /** Enable observability (Monitoring + Dashboard). Defaults to true. */
  observability?: boolean;
  /** Factory that creates the service stack(s) inside this stage */
  stackFactory: (scope: Stage, ctx: StageContext) => void;
}

export class ServiceStage extends Stage {
  readonly prefix: string;
  readonly production: boolean;
  readonly observability: boolean;

  constructor(scope: Construct, id: string, props: ServiceStageProps) {
    super(scope, id, props);

    this.prefix = props.prefix;
    this.production = props.production;
    this.observability = props.observability ?? true;

    // Set prefix and observability on context so hub stacks (which read from context) also work
    this.node.setContext('prefix', props.prefix);
    this.node.setContext('observability', String(this.observability));

    props.stackFactory(this, {
      prefix: this.prefix,
      production: this.production,
      observability: this.observability,
    });
  }
}
```

- [ ] **Step 4: Export from index.ts**

Add to `libs/cdk-constructs/src/index.ts`:

```typescript
export { ServiceStage, ServiceStageProps, StageContext } from './service-stage';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx nx run cdk-constructs:test -- --testPathPattern=service-stage`
Expected: PASS (7 tests)

- [ ] **Step 6: Run all cdk-constructs tests**

Run: `npx nx run cdk-constructs:test --skip-nx-cache`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add libs/cdk-constructs/src/service-stage.ts \
       libs/cdk-constructs/src/index.ts \
       libs/cdk-constructs/test/service-stage.test.ts
git commit -m "feat(cdk-constructs): add ServiceStage construct with observability toggle"
```

---

## Chunk 3: CDK Pipeline Infrastructure

### Task 8: Install cdk-pipelines-github

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run: `pnpm add -D cdk-pipelines-github`

- [ ] **Step 2: Verify installation**

Run: `node -e "require('cdk-pipelines-github'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add cdk-pipelines-github dependency"
```

---

### Task 9: Create the pipeline infrastructure project

**Files:**
- Create: `infrastructure/pipeline/project.json`
- Create: `infrastructure/pipeline/tsconfig.json`
- Create: `infrastructure/pipeline/src/discover-services.ts`
- Create: `infrastructure/pipeline/test/discover-services.test.ts`
- Create: `infrastructure/pipeline/src/pipeline.app.ts`
- Create: `infrastructure/pipeline/src/github-role.app.ts`
- Create: `infrastructure/pipeline/src/github-role.stack.ts`

**Important architecture note:** The pipeline creates one `ServiceStage` per service. Each stage creates its stack via dynamic `require()` of the service's `service.stack.ts`. Hub stacks (which extend plain `Stack` and read prefix from CDK context) work because `ServiceStage` sets `prefix` on its context. ServiceStack subclasses work because the dynamic constructor passes `prefix` as a prop. The class is discovered by naming convention: the export whose name ends in `Stack`.

- [ ] **Step 1: Create directory and project.json**

Run: `mkdir -p infrastructure/pipeline/src infrastructure/pipeline/test`

Create `infrastructure/pipeline/project.json`:

```json
{
  "name": "pipeline",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "infrastructure/pipeline/src",
  "projectType": "application",
  "targets": {
    "synth": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk synth --app 'npx ts-node -r ./tools/register-paths.js infrastructure/pipeline/src/pipeline.app.ts'"
      }
    },
    "deploy-role": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js infrastructure/pipeline/src/github-role.app.ts'"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": {
        "jestConfig": "infrastructure/pipeline/jest.config.ts"
      }
    }
  },
  "tags": ["scope:infrastructure"]
}
```

- [ ] **Step 2: Create tsconfig.json and jest.config.ts**

Create `infrastructure/pipeline/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "module": "commonjs" },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Create `infrastructure/pipeline/jest.config.ts`:

```typescript
export default {
  displayName: 'pipeline',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
};
```

- [ ] **Step 3: Create discover-services module with tests**

Create `infrastructure/pipeline/src/discover-services.ts`:

```typescript
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface PipelineConfig {
  service: string;
  subsystem: string;
  deploymentPhase: number;
  production: { regions: string[]; parallelDeploy: boolean };
  dependencies: string[];
}

/**
 * Discovers all pipeline.json files under services/ and returns parsed configs.
 */
export function discoverServices(workspaceRoot: string): PipelineConfig[] {
  const configs: PipelineConfig[] = [];
  const servicesDir = join(workspaceRoot, 'services');

  for (const domain of readdirSync(servicesDir)) {
    const domainPath = join(servicesDir, domain);
    if (!statSync(domainPath).isDirectory()) continue;

    for (const service of readdirSync(domainPath)) {
      const pipelinePath = join(domainPath, service, 'pipeline.json');
      try {
        const raw = readFileSync(pipelinePath, 'utf8');
        const config = JSON.parse(raw) as PipelineConfig;
        configs.push(config);
      } catch {
        // No pipeline.json — skip
      }
    }
  }

  return configs.sort((a, b) => a.deploymentPhase - b.deploymentPhase);
}

/**
 * Groups services by deployment phase.
 */
export function groupByPhase(configs: PipelineConfig[]): Map<number, PipelineConfig[]> {
  const phases = new Map<number, PipelineConfig[]>();
  for (const config of configs) {
    const list = phases.get(config.deploymentPhase) ?? [];
    list.push(config);
    phases.set(config.deploymentPhase, list);
  }
  return phases;
}

/**
 * Resolves the filesystem path for a service.
 */
export function resolveServiceDir(workspaceRoot: string, svc: PipelineConfig): string {
  const servicesDir = join(workspaceRoot, 'services');

  // Try subsystem/service (the standard layout)
  const bySubsystem = join(servicesDir, svc.subsystem, svc.service);
  try {
    if (statSync(bySubsystem).isDirectory()) return bySubsystem;
  } catch { /* not found */ }

  // Scan all domain directories
  for (const domain of readdirSync(servicesDir)) {
    const candidate = join(servicesDir, domain, svc.service);
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch { /* not found */ }
  }

  throw new Error(`Cannot find service directory for ${svc.service}`);
}

/**
 * Dynamically loads the Stack class from a service's service.stack.ts.
 * Convention: the exported class whose name ends with "Stack".
 */
export function loadStackClass(serviceDir: string, serviceName: string): any {
  const modulePath = join(serviceDir, 'src', 'service.stack');
  const stackModule = require(modulePath);

  const StackClass = Object.values(stackModule).find(
    (v: any) => typeof v === 'function' && /Stack$/.test(v.name)
  );

  if (!StackClass) {
    throw new Error(`No class ending in "Stack" found in ${serviceName}/src/service.stack.ts`);
  }

  return StackClass;
}
```

Create `infrastructure/pipeline/test/discover-services.test.ts`:

```typescript
import { groupByPhase, PipelineConfig } from '../src/discover-services';

const mockConfigs: PipelineConfig[] = [
  { service: 'investor-hub', subsystem: 'investor', deploymentPhase: 1, production: { regions: ['us-east-1'], parallelDeploy: true }, dependencies: [] },
  { service: 'investor-web', subsystem: 'investor', deploymentPhase: 2, production: { regions: ['us-east-1'], parallelDeploy: false }, dependencies: ['investor-hub'] },
  { service: 'investor-bff', subsystem: 'investor', deploymentPhase: 3, production: { regions: ['us-east-1'], parallelDeploy: true }, dependencies: ['investor-hub'] },
  { service: 'advisory-hub', subsystem: 'advisory', deploymentPhase: 1, production: { regions: ['us-east-1'], parallelDeploy: true }, dependencies: [] },
];

describe('groupByPhase', () => {
  it('groups services by deployment phase', () => {
    const phases = groupByPhase(mockConfigs);
    expect(phases.get(1)!.map(c => c.service)).toEqual(['investor-hub', 'advisory-hub']);
    expect(phases.get(2)!.map(c => c.service)).toEqual(['investor-web']);
    expect(phases.get(3)!.map(c => c.service)).toEqual(['investor-bff']);
  });

  it('returns empty map for empty input', () => {
    const phases = groupByPhase([]);
    expect(phases.size).toBe(0);
  });
});
```

- [ ] **Step 4: Run discover-services tests**

Run: `npx nx run pipeline:test`
Expected: PASS (2 tests)

- [ ] **Step 5: Create the pipeline app**

Create `infrastructure/pipeline/src/pipeline.app.ts`:

```typescript
import { App } from 'aws-cdk-lib';
import { ShellStep } from 'aws-cdk-lib/pipelines';
import { GitHubWorkflow, AwsCredentials } from 'cdk-pipelines-github';
import { join } from 'path';
import { ServiceStage } from '@nestfolio/cdk-constructs';
import { discoverServices, groupByPhase, resolveServiceDir, loadStackClass } from './discover-services';

const workspaceRoot = join(__dirname, '..', '..', '..');
const app = new App();

const accountId = app.node.tryGetContext('account') ?? process.env['CDK_DEFAULT_ACCOUNT'];
const region = app.node.tryGetContext('region') ?? 'us-east-1';
if (!accountId) throw new Error('"account" context or CDK_DEFAULT_ACCOUNT is required');

const roleArn = `arn:aws:iam::${accountId}:role/nestfolio-github-actions-role`;

// Discover services
const allServices = discoverServices(workspaceRoot);
const phases = groupByPhase(allServices);
const sortedPhases = Array.from(phases.keys()).sort();

// --- Pipeline ---

const pipeline = new GitHubWorkflow(app, 'NestfolioPipeline', {
  synth: new ShellStep('Synth', {
    installCommands: ['npm install -g pnpm'],
    commands: [
      'pnpm install --frozen-lockfile',
      'ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)',
      `npx cdk synth --app 'npx ts-node -r ./tools/register-paths.js infrastructure/pipeline/src/pipeline.app.ts' -c account=$ACCOUNT_ID -c region=${region}`,
    ],
  }),
  awsCreds: AwsCredentials.fromOpenIdConnect({
    gitHubActionRoleArn: roleArn,
  }),
  workflowPath: '.github/workflows/deploy.yml',
  workflowTriggers: {
    push: { branches: ['main'] },
  },
});

// Helper: create a ServiceStage for a single service
function createServiceStage(
  svc: ReturnType<typeof discoverServices>[number],
  prefix: string,
  production: boolean,
  observability: boolean,
  env: { account: string; region: string },
): ServiceStage {
  const serviceDir = resolveServiceDir(workspaceRoot, svc);
  const StackClass = loadStackClass(serviceDir, svc.service);

  return new ServiceStage(app, `${prefix}-${svc.service}`, {
    prefix,
    production,
    observability,
    env,
    stackFactory: (scope, ctx) => {
      new StackClass(scope, `${prefix}-${svc.service}-stack`, {
        prefix: ctx.prefix,
        terminationProtection: ctx.production,
        observability: ctx.observability,
        env,
      });
    },
  });
}

// --- Staging (auto-deploy on push to main, observability enabled) ---

const stagingEnv = { account: accountId, region };

for (const phase of sortedPhases) {
  const servicesInPhase = phases.get(phase)!;
  const wave = pipeline.addGitHubWave(`Staging-Phase-${phase}`);

  for (const svc of servicesInPhase) {
    const stage = createServiceStage(svc, 'staging', false, true, stagingEnv);
    wave.addStageWithGitHubOptions(stage, {
      gitHubEnvironment: { name: 'staging' },
    });
  }
}

// --- Production (manual approval via GitHub Environment, observability enabled) ---

const prodEnv = { account: accountId, region };

for (const phase of sortedPhases) {
  const servicesInPhase = phases.get(phase)!;
  const wave = pipeline.addGitHubWave(`Prod-Phase-${phase}`);

  for (const svc of servicesInPhase) {
    const stage = createServiceStage(svc, 'prod', true, true, prodEnv);
    wave.addStageWithGitHubOptions(stage, {
      gitHubEnvironment: { name: 'production' },
    });
  }
}

app.synth();
```

- [ ] **Step 6: Create the GitHub role bootstrap app**

Create `infrastructure/pipeline/src/github-role.stack.ts`:

```typescript
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { GitHubActionRole } from 'cdk-pipelines-github';

export interface GitHubRoleStackProps extends StackProps {
  repos: string[];
}

export class GitHubRoleStack extends Stack {
  constructor(scope: Construct, id: string, props: GitHubRoleStackProps) {
    super(scope, id, props);

    const role = new GitHubActionRole(this, 'GitHubRole', {
      repos: props.repos,
      roleName: 'nestfolio-github-actions-role',
    });

    new CfnOutput(this, 'RoleArn', {
      value: role.role.roleArn,
      description: 'ARN of the GitHub Actions OIDC role',
    });
  }
}
```

Create `infrastructure/pipeline/src/github-role.app.ts`:

```typescript
import { App } from 'aws-cdk-lib';
import { GitHubRoleStack } from './github-role.stack';

const app = new App();
const repo = app.node.tryGetContext('repo');
if (!repo) throw new Error('Pass -c repo=org/nestfolio');

new GitHubRoleStack(app, 'nestfolio-github-role', {
  repos: [repo],
  env: { region: 'us-east-1' },
});

app.synth();
```

- [ ] **Step 7: Verify synth works**

Run:
```bash
npx cdk synth \
  --app 'npx ts-node -r ./tools/register-paths.js infrastructure/pipeline/src/pipeline.app.ts' \
  -c account=123456789012 -c region=us-east-1 \
  2>&1 | tail -20
```

Expected: Cloud assembly output (warnings about OIDC role are expected)

- [ ] **Step 8: Verify generated workflow exists and has correct structure**

Run: `head -30 .github/workflows/deploy.yml`

Expected: YAML with `on: push: branches: [main]`, job names containing `Staging` and `Prod`, `permissions: id-token: write`

- [ ] **Step 9: Commit**

```bash
git add infrastructure/pipeline/
git commit -m "feat: add cdk-pipelines-github pipeline with staging + production"
```

---

## Chunk 4: Workflow Migration & Documentation

### Task 10: Remove old main-deploy.yml, keep PR workflows

**Files:**
- Delete: `.github/workflows/main-deploy.yml`
- Modify: `.github/workflows/pr-deploy.yml` (verify jq available)

The generated `deploy.yml` replaces `main-deploy.yml`. PR workflows stay hand-written.

- [ ] **Step 1: Remove main-deploy.yml**

```bash
git rm .github/workflows/main-deploy.yml
```

- [ ] **Step 2: Add jq verification to pr-deploy.yml sandbox-deploy job**

In `.github/workflows/pr-deploy.yml`, in the `sandbox-deploy` job steps, before the deploy step, add:

```yaml
      - name: Verify jq is available
        run: jq --version
```

- [ ] **Step 3: Verify pr-cleanup.yml calls destroy-all.sh correctly**

Read `.github/workflows/pr-cleanup.yml` and verify it calls `bash destroy-all.sh "sandbox-pr-..."`. No changes needed if correct.

- [ ] **Step 4: Add generated deploy.yml to git**

```bash
git add .github/workflows/deploy.yml
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/pr-deploy.yml
git commit -m "ci: replace main-deploy.yml with CDK-generated deploy.yml, update PR workflow"
```

---

### Task 11: Write pipeline documentation

**Files:**
- Create: `infrastructure/pipeline/README.md`

- [ ] **Step 1: Write README**

Create `infrastructure/pipeline/README.md`:

````markdown
# Nestfolio Pipeline Infrastructure

## Quick Start

### 1. Bootstrap the GitHub OIDC Role (once per AWS account)

```bash
npx cdk deploy \
  --app 'npx ts-node -r ./tools/register-paths.js infrastructure/pipeline/src/github-role.app.ts' \
  -c repo=YOUR_ORG/nestfolio
```

Note the role ARN from the output. Add it as a GitHub secret: `AWS_ROLE_ARN`.

### 2. Configure GitHub Environments

In GitHub repo Settings → Environments:

| Environment | Protection Rules |
|-------------|-----------------|
| staging | None (auto-deploys on push to main) |
| production | Required reviewers (1-5 people) |
| sandbox | None (used by PR pipelines) |

Each environment needs the `AWS_ROLE_ARN` secret.

### 3. Synth and Commit the Pipeline

```bash
npx nx run pipeline:synth -- -c account=$(aws sts get-caller-identity --query Account --output text) -c region=us-east-1
git add .github/workflows/deploy.yml
git commit -m "ci: update generated pipeline workflow"
git push
```

## Deployment Paths

| Path | Trigger | Mechanism | Observability |
|------|---------|-----------|---------------|
| Manual | `bash deploy-all.sh <prefix>` | Direct stack deploys | `--no-observability` flag to disable |
| Sandbox (PR) | PR to main | `pr-deploy.yml` → `deploy-all.sh` | Configurable per PR |
| Staging | Push to main | CDK-generated `deploy.yml` | Enabled |
| Production | After staging | GitHub Environment approval | Enabled |

## Manual Deployment

```bash
# Deploy with observability (default)
bash deploy-all.sh dev

# Deploy without observability (lighter, cheaper)
bash deploy-all.sh dev --no-observability

# Tear down
bash destroy-all.sh dev
```

## Re-generating the Pipeline

After changing `pipeline.app.ts` or adding new services:

```bash
npx nx run pipeline:synth -- -c account=<ACCOUNT> -c region=us-east-1
# Commit the regenerated deploy.yml
```

## Service Discovery

Services are discovered from `pipeline.json` files. To add a new service to the pipeline, create a `pipeline.json` in its directory. See `.pipeline-schema.json` for the schema.
````

- [ ] **Step 2: Commit**

```bash
git add infrastructure/pipeline/README.md
git commit -m "docs: add pipeline infrastructure documentation"
```

---

## Chunk 5: Integration Testing & Verification

### Task 12: Validate all pipeline configs

- [ ] **Step 1: Run validation**

Run: `bash .github/scripts/validate-pipeline-configs.sh`
Expected: All 16 pipeline.json files valid

---

### Task 13: Run all tests

- [ ] **Step 1: Run cdk-constructs tests**

Run: `npx nx run cdk-constructs:test --skip-nx-cache`
Expected: All tests pass

- [ ] **Step 2: Run pipeline tests**

Run: `npx nx run pipeline:test --skip-nx-cache`
Expected: All tests pass

- [ ] **Step 3: Run full affected test suite**

Run: `npx nx affected -t test --base=main --parallel=3`
Expected: All tests pass

---

### Task 14: Verify deploy scripts

- [ ] **Step 1: Syntax check**

Run: `bash -n deploy-all.sh && bash -n destroy-all.sh && echo "OK"`
Expected: `OK`

- [ ] **Step 2: Verify no stale service references**

Run: `grep -r "portfolio-bff\|portfolio-ctrl" deploy-all.sh destroy-all.sh .github/workflows/ 2>/dev/null; echo "done"`
Expected: No matches, then `done`

---

### Task 15: Final cleanup and commit

- [ ] **Step 1: Add cdk.out to .gitignore if not already present**

Run: `grep -q 'cdk.out' .gitignore || echo 'cdk.out/' >> .gitignore`

- [ ] **Step 2: Verify git status**

Run: `git status`
Expected: Clean or only expected changes

- [ ] **Step 3: Final commit if anything remains**

```bash
git add -A
git commit -m "chore: pipeline migration complete"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| **1** | 1-6 | Pipeline schema + 5 missing configs, observability toggle in ServiceStack + hub stacks, dynamic deploy/destroy scripts |
| **2** | 7 | `ServiceStage` CDK construct with prefix/production/observability, tested |
| **3** | 8-9 | `cdk-pipelines-github` pipeline app, staging + production, OIDC role bootstrap, discover-services with tests |
| **4** | 10-11 | Workflow migration (remove old, add generated), PR workflow updates, documentation |
| **5** | 12-15 | Integration testing, validation, cleanup |

**Total: 15 tasks across 5 chunks**

### Observability per environment

| Deployment | Default | Override |
|------------|---------|----------|
| Manual (`deploy-all.sh`) | enabled | `--no-observability` flag |
| Sandbox (PR) | enabled | Add `--no-observability` to `pr-deploy.yml` deploy step |
| Staging | enabled | Change `observability: true` → `false` in `pipeline.app.ts` |
| Production | enabled | Change `observability: true` → `false` in `pipeline.app.ts` |

### Services covered (16 total)

| Phase | Services |
|-------|----------|
| 1 (Hubs) | investor-hub, advisory-hub, execution-hub, ledger-hub |
| 2 (Auth) | investor-web |
| 3 (Services) | investor-bff, investor-ctrl, advisory-bff, advisory-ctrl, compliance-ctrl, execution-ctrl, execution-adpt, dashboard-bff, ledger-ctrl, ledger-bff, reconciliation-ctrl |

### Deployment paths

| Path | Trigger | Mechanism |
|------|---------|-----------|
| Manual | `bash deploy-all.sh <prefix>` | Direct stack deploys, pipeline.json-driven |
| Sandbox | `pull_request` to main | Hand-written `pr-deploy.yml` → `deploy-all.sh` |
| Staging | Push to main | CDK-generated `deploy.yml` → `cdk-pipelines-github` stages |
| Production | After staging | CDK-generated `deploy.yml` → GitHub Environment approval |
