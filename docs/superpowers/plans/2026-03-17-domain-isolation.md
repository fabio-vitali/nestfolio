# Domain Isolation & Service Boundaries Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce two-level domain isolation — in-domain `/service` barrels restricted by scope tags, cross-domain `/domain` barrels only on adapter services — via Nx enforce-module-boundaries.

**Architecture:** Rename existing `/domain` barrels to `/service`, create 4 new adapter services (investor-adpt, advisory-adpt, execution-adpt, ledger-adpt) with `/domain` barrels for cross-domain contracts, move EventBridge forwarding rules from hubs to adapters, rename old execution-adpt to broker-adpt.

**Tech Stack:** Nx, ESLint (@nx/enforce-module-boundaries), AWS CDK (EventBridge), TypeScript, Zod

**Spec:** `docs/superpowers/specs/2026-03-16-domain-isolation-design.md`

---

## Chunk 1: Rename execution-adpt → broker-adpt

### Task 1: Rename execution-adpt directory and project config

**Files:**
- Move: `services/execution/execution-adpt/` → `services/execution/broker-adpt/`
- Modify: `services/execution/broker-adpt/project.json`
- Modify: `services/execution/broker-adpt/src/main.ts`
- Modify: `services/execution/broker-adpt/src/service.stack.ts` (class name)
- Modify: `services/execution/broker-adpt/jest.config.js`

- [ ] **Step 1: Move the directory**

```bash
mv services/execution/execution-adpt services/execution/broker-adpt
```

- [ ] **Step 2: Update project.json**

In `services/execution/broker-adpt/project.json`, change:
```json
{
  "name": "broker-adpt",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/execution/broker-adpt/src",
  "projectType": "application",
  "targets": {
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js services/execution/broker-adpt/src/main.ts' --require-approval never -c prefix={args.prefix}"
      }
    },
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/execution/broker-adpt/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": { "jestConfig": "services/execution/broker-adpt/jest.config.js" }
    },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "tags": ["scope:execution", "type:adpt"]
}
```

- [ ] **Step 3: Update main.ts**

In `services/execution/broker-adpt/src/main.ts`:
```ts
import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { BrokerAdptStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'broker-adpt');

new BrokerAdptStack(app, `${config.prefix}-broker-adpt`, {
  prefix: config.prefix,
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
```

- [ ] **Step 4: Rename class in service.stack.ts**

In `services/execution/broker-adpt/src/service.stack.ts`:
- Rename class `ExecutionAdptStack` → `BrokerAdptStack`
- Update `service: 'broker-adpt'` in naming/tags calls

- [ ] **Step 5: Update jest.config.js**

In `services/execution/broker-adpt/jest.config.js`:
- Change `displayName: 'broker-adpt'`
- Update `moduleNameMapper` paths — change `<rootDir>` relative paths if directory depth changed (it didn't, same level)

- [ ] **Step 6: Update tsconfig.base.json**

Change the path alias:
```
"@nestfolio/execution-adpt/domain" → "@nestfolio/broker-adpt/service"
```
pointing to `services/execution/broker-adpt/src/domain/index.ts` (directory rename to service-domain happens in Task 2).

- [ ] **Step 7: Update all imports of @nestfolio/execution-adpt/domain**

These files reference `@nestfolio/execution-adpt/domain` and need updating to `@nestfolio/broker-adpt/service` (temporary — will become adapter domain import in Chunk 3):

Source files:
- `services/execution/execution-ctrl/src/handlers/event-listener.ts` — **NOT needed** (execution-ctrl doesn't import from execution-adpt)
- `services/advisory/advisory-ctrl/src/handlers/event-listener.ts:15` — if present
- `services/ledger/ledger-ctrl/src/handlers/event-listener.ts:5` — `ExecutionAdptEventTypes`
- `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts:5` — `ExecutionAdptEventTypes`
- `services/investor/investor-ctrl/src/handlers/event-listener.ts:6` — `ExecutionAdptEventTypes`

Jest configs:
- `services/ledger/reconciliation-ctrl/jest.config.js` — update mapper path
- `services/ledger/ledger-ctrl/jest.config.js` — update mapper path
- `services/investor/investor-ctrl/jest.config.js` — update mapper path
- `services/advisory/advisory-ctrl/jest.config.js` — update mapper path

For each import, change:
```ts
// Before
import { ExecutionAdptEventTypes } from '@nestfolio/execution-adpt/domain';
// After (temporary, until adapter barrels exist)
import { ExecutionAdptEventTypes } from '@nestfolio/broker-adpt/service';
```

For each jest.config.js mapper, change:
```js
// Before
'^@nestfolio/execution-adpt/domain$': '<rootDir>/../../execution/execution-adpt/src/domain/index.ts',
// After
'^@nestfolio/broker-adpt/service$': '<rootDir>/../../execution/broker-adpt/src/domain/index.ts',
```

- [ ] **Step 8: Reset Nx cache (avoid stale project references)**

```bash
npx nx reset
```

- [ ] **Step 9: Run tests for affected services**

```bash
npx nx run-many -t test --projects=broker-adpt,ledger-ctrl,reconciliation-ctrl,investor-ctrl,advisory-ctrl
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: rename execution-adpt to broker-adpt (external broker integration)"
```

---

## Chunk 2: Rename /domain barrels → /service + update all paths

### Task 2: Rename domain directories and tsconfig paths

**Files:**
- Move: 9 × `src/domain/` → `src/service-domain/` directories
- Modify: `tsconfig.base.json` (9 path renames)
- Modify: ~30 jest.config.js `moduleNameMapper` entries
- Modify: ~20 source imports referencing relative `../domain/` paths

- [ ] **Step 1: Rename all 9 domain directories**

```bash
# Investor domain
mv services/investor/investor-bff/src/domain services/investor/investor-bff/src/service-domain
mv services/investor/investor-ctrl/src/domain services/investor/investor-ctrl/src/service-domain

# Advisory domain
mv services/advisory/advisory-bff/src/domain services/advisory/advisory-bff/src/service-domain
mv services/advisory/advisory-ctrl/src/domain services/advisory/advisory-ctrl/src/service-domain
mv services/advisory/compliance-ctrl/src/domain services/advisory/compliance-ctrl/src/service-domain

# Execution domain
mv services/execution/execution-ctrl/src/domain services/execution/execution-ctrl/src/service-domain
mv services/execution/broker-adpt/src/domain services/execution/broker-adpt/src/service-domain

# Ledger domain
mv services/ledger/ledger-ctrl/src/domain services/ledger/ledger-ctrl/src/service-domain
mv services/ledger/reconciliation-ctrl/src/domain services/ledger/reconciliation-ctrl/src/service-domain
```

- [ ] **Step 2: Update tsconfig.base.json paths**

Replace the 9 domain paths (and the broker-adpt one from Task 1) with `/service` paths pointing to `service-domain/`:

```json
"@nestfolio/investor-bff/service": ["services/investor/investor-bff/src/service-domain/index.ts"],
"@nestfolio/investor-ctrl/service": ["services/investor/investor-ctrl/src/service-domain/index.ts"],
"@nestfolio/advisory-ctrl/service": ["services/advisory/advisory-ctrl/src/service-domain/index.ts"],
"@nestfolio/advisory-bff/service": ["services/advisory/advisory-bff/src/service-domain/index.ts"],
"@nestfolio/compliance-ctrl/service": ["services/advisory/compliance-ctrl/src/service-domain/index.ts"],
"@nestfolio/execution-ctrl/service": ["services/execution/execution-ctrl/src/service-domain/index.ts"],
"@nestfolio/broker-adpt/service": ["services/execution/broker-adpt/src/service-domain/index.ts"],
"@nestfolio/ledger-ctrl/service": ["services/ledger/ledger-ctrl/src/service-domain/index.ts"],
"@nestfolio/reconciliation-ctrl/service": ["services/ledger/reconciliation-ctrl/src/service-domain/index.ts"]
```

- [ ] **Step 3: Update all source file imports**

Replace every `@nestfolio/<service>/domain` import with `@nestfolio/<service>/service`.

Files with cross-module imports (from exploration data):

**Investor domain services:**
```
services/investor/investor-ctrl/src/handlers/event-listener.ts:
  @nestfolio/investor-bff/domain → @nestfolio/investor-bff/service
  @nestfolio/compliance-ctrl/domain → @nestfolio/compliance-ctrl/service (cross-domain, will change again in Chunk 3)
  @nestfolio/execution-adpt/domain → already changed to @nestfolio/broker-adpt/service in Task 1

services/investor/investor-bff/src/handlers/event-listener.ts:
  @nestfolio/investor-ctrl/domain → @nestfolio/investor-ctrl/service
  @nestfolio/ledger-ctrl/domain → @nestfolio/ledger-ctrl/service (cross-domain, will change in Chunk 3)

services/investor/dashboard-bff/src/handlers/event-listener.ts:
  @nestfolio/ledger-ctrl/domain → @nestfolio/ledger-ctrl/service (cross-domain)
  @nestfolio/reconciliation-ctrl/domain → @nestfolio/reconciliation-ctrl/service (cross-domain)
  @nestfolio/advisory-ctrl/domain → @nestfolio/advisory-ctrl/service (cross-domain)
  @nestfolio/compliance-ctrl/domain → @nestfolio/compliance-ctrl/service (cross-domain)
  @nestfolio/investor-bff/domain → @nestfolio/investor-bff/service
```

**Advisory domain services:**
```
services/advisory/advisory-ctrl/src/handlers/event-listener.ts:
  @nestfolio/advisory-bff/domain → @nestfolio/advisory-bff/service
  @nestfolio/compliance-ctrl/domain → @nestfolio/compliance-ctrl/service
  @nestfolio/investor-bff/domain → @nestfolio/investor-bff/service (cross-domain)

services/advisory/advisory-bff/src/handlers/event-listener.ts:
  @nestfolio/advisory-ctrl/domain → @nestfolio/advisory-ctrl/service
  @nestfolio/compliance-ctrl/domain → @nestfolio/compliance-ctrl/service

services/advisory/compliance-ctrl/src/rules/rule-engine.ts:
  @nestfolio/investor-bff/domain → @nestfolio/investor-bff/service (cross-domain, MandateLevel type)
```

**Execution domain services:**
```
services/execution/execution-ctrl/src/handlers/event-listener.ts:
  @nestfolio/compliance-ctrl/domain → @nestfolio/compliance-ctrl/service (cross-domain)
  @nestfolio/advisory-bff/domain → @nestfolio/advisory-bff/service (cross-domain)
  @nestfolio/advisory-ctrl/domain → @nestfolio/advisory-ctrl/service (cross-domain)
  @nestfolio/investor-bff/domain → @nestfolio/investor-bff/service (cross-domain)

services/execution/execution-ctrl/src/repositories/order.repository.ts:
  @nestfolio/advisory-ctrl/domain → @nestfolio/advisory-ctrl/service (cross-domain, ProposedTrade)

services/execution/execution-ctrl/src/services/safety-checks.service.ts:
  @nestfolio/advisory-ctrl/domain → @nestfolio/advisory-ctrl/service (cross-domain, ProposedTrade)

services/execution/execution-ctrl/src/services/order-lifecycle.service.ts:
  @nestfolio/advisory-ctrl/domain → @nestfolio/advisory-ctrl/service (cross-domain, ProposedTrade)

services/execution/broker-adpt/src/handlers/event-listener.ts:
  @nestfolio/execution-ctrl/domain → @nestfolio/execution-ctrl/service
  @nestfolio/investor-bff/domain → @nestfolio/investor-bff/service (cross-domain)
```

**Ledger domain services:**
```
services/ledger/ledger-ctrl/src/handlers/event-listener.ts:
  @nestfolio/advisory-ctrl/domain → @nestfolio/advisory-ctrl/service (cross-domain)
  (broker-adpt already updated in Task 1)

services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts:
  @nestfolio/ledger-ctrl/domain → @nestfolio/ledger-ctrl/service
  (broker-adpt already updated in Task 1)

services/ledger/ledger-bff/src/handlers/event-listener.ts:
  @nestfolio/ledger-ctrl/domain → @nestfolio/ledger-ctrl/service
```

Also update any relative `../domain/` imports within the same service (e.g., investor-bff event-listener imports from `../domain/events` → `../service-domain/events`).

- [ ] **Step 4: Update all jest.config.js moduleNameMapper entries**

Every jest.config.js that maps `@nestfolio/*/domain` needs updating. Pattern for each:

```js
// Before
'^@nestfolio/advisory-ctrl/domain$': '<rootDir>/../../advisory/advisory-ctrl/src/domain/index.ts',
// After
'^@nestfolio/advisory-ctrl/service$': '<rootDir>/../../advisory/advisory-ctrl/src/service-domain/index.ts',
```

Files to update (from grep data):
- `services/advisory/compliance-ctrl/jest.config.js` (2 entries)
- `services/advisory/advisory-bff/jest.config.js` (2 entries)
- `services/advisory/advisory-ctrl/jest.config.js` (5 entries)
- `services/execution/broker-adpt/jest.config.js` (2 entries, already partially done)
- `services/execution/execution-ctrl/jest.config.js` (4 entries)
- `services/investor/investor-bff/jest.config.js` (2 entries)
- `services/investor/investor-ctrl/jest.config.js` (4 entries)
- `services/investor/dashboard-bff/jest.config.js` (5 entries)
- `services/ledger/reconciliation-ctrl/jest.config.js` (2 entries)
- `services/ledger/ledger-ctrl/jest.config.js` (2 entries)
- `services/ledger/ledger-bff/jest.config.js` (1 entry)

- [ ] **Step 5: Run full test suite**

```bash
npx nx run-many -t test
```

Expected: all projects pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename /domain barrels to /service for in-domain type isolation"
```

---

## Chunk 3: Create adapter services with /domain barrels

### Task 3: Create investor-adpt adapter service

**Files:**
- Create: `services/investor/investor-adpt/project.json`
- Create: `services/investor/investor-adpt/tsconfig.json`
- Create: `services/investor/investor-adpt/src/domain/index.ts`
- Create: `services/investor/investor-adpt/src/domain/events.ts`
- Create: `services/investor/investor-adpt/src/service.stack.ts`
- Create: `services/investor/investor-adpt/src/main.ts`
- Modify: `tsconfig.base.json` (add path)

- [ ] **Step 1: Create project.json**

Create `services/investor/investor-adpt/project.json`:
```json
{
  "name": "investor-adpt",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "services/investor/investor-adpt/src",
  "projectType": "application",
  "targets": {
    "deploy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk deploy --app 'npx ts-node -r ./tools/register-paths.js services/investor/investor-adpt/src/main.ts' --require-approval never -c prefix={args.prefix}"
      }
    },
    "destroy": {
      "executor": "nx:run-commands",
      "options": {
        "command": "npx cdk destroy --app 'npx ts-node -r ./tools/register-paths.js services/investor/investor-adpt/src/main.ts' --force -c prefix={args.prefix}"
      }
    },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "tags": ["scope:investor", "type:adpt"]
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `services/investor/investor-adpt/tsconfig.json`:
```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../../../dist/services/investor/investor-adpt"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create domain events barrel**

Create `services/investor/investor-adpt/src/domain/events.ts`:
```ts
/**
 * Cross-domain event types published by the investor domain.
 * These are the events that other domains may consume.
 */
export const InvestorCrossDomainEventTypes = {
  // → Advisory
  GOAL_UPDATED: 'GOAL_UPDATED',
  RISK_PROFILE_UPDATED: 'RISK_PROFILE_UPDATED',
  OPERATING_MODE_CHANGED: 'OPERATING_MODE_CHANGED',
  MANDATE_GRANTED: 'MANDATE_GRANTED',
  MANDATE_UPDATED: 'MANDATE_UPDATED',
  MANDATE_REVOKED: 'MANDATE_REVOKED',
  // → Execution
  DEPOSIT_INITIATED: 'DEPOSIT_INITIATED',
  WITHDRAWAL_REQUESTED: 'WITHDRAWAL_REQUESTED',
  ACCOUNT_CLOSURE_REQUESTED: 'ACCOUNT_CLOSURE_REQUESTED',
} as const;

export type InvestorCrossDomainEventType =
  (typeof InvestorCrossDomainEventTypes)[keyof typeof InvestorCrossDomainEventTypes];
```

- [ ] **Step 4: Create domain index barrel**

Create `services/investor/investor-adpt/src/domain/index.ts`:
```ts
export { InvestorCrossDomainEventTypes } from './events';
export type { InvestorCrossDomainEventType } from './events';

// Re-export cross-domain types from internal services that external consumers need
export type {
  MandateLevel, OperatingMode, RebalanceCadence,
} from '@nestfolio/investor-bff/service';
```

- [ ] **Step 5: Create service.stack.ts**

Create `services/investor/investor-adpt/src/service.stack.ts`:
```ts
import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { EventBus as EventBusTarget } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { createNamingService, applyStandardTags, getPrefix } from '@nestfolio/cdk-constructs';

export class InvestorAdptStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const naming = createNamingService(this, {
      subsystem: 'investor',
      service: 'investor-adpt',
    });

    const prefix = getPrefix(this);
    applyStandardTags(this, { service: 'investor-adpt', domain: 'investor', environment: prefix });

    // Resolve in-domain bus
    const investorBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-investor/event-hub/busArn`,
    );
    const investorBus = EventBus.fromEventBusArn(this, 'InvestorBus', investorBusArn);

    // Cross-domain forwarding: Investor → Advisory
    const advisoryBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-advisory/event-hub/busArn`,
    );
    const advisoryBus = EventBus.fromEventBusArn(this, 'AdvisoryBus', advisoryBusArn);
    const toAdvisoryDlq = new Queue(this, 'ToAdvisoryDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToAdvisory', {
      eventBus: investorBus,
      eventPattern: {
        detailType: [
          'GOAL_UPDATED',
          'RISK_PROFILE_UPDATED',
          'OPERATING_MODE_CHANGED',
          'MANDATE_GRANTED',
          'MANDATE_UPDATED',
          'MANDATE_REVOKED',
        ],
      },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: toAdvisoryDlq })],
    });

    // Cross-domain forwarding: Investor → Execution
    const executionBusArn = StringParameter.valueForStringParameter(
      this,
      `/nestfolio/${prefix}-execution/event-hub/busArn`,
    );
    const executionBus = EventBus.fromEventBusArn(this, 'ExecutionBus', executionBusArn);
    const toExecutionDlq = new Queue(this, 'ToExecutionDLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });
    new Rule(this, 'ToExecution', {
      eventBus: investorBus,
      eventPattern: {
        detailType: ['DEPOSIT_INITIATED', 'WITHDRAWAL_REQUESTED', 'ACCOUNT_CLOSURE_REQUESTED'],
      },
      targets: [new EventBusTarget(executionBus, { deadLetterQueue: toExecutionDlq })],
    });
  }
}
```

- [ ] **Step 6: Create main.ts**

Create `services/investor/investor-adpt/src/main.ts`:
```ts
import { App } from 'aws-cdk-lib';
import { resolvePipelineConfig } from '@nestfolio/cdk-constructs';
import { InvestorAdptStack } from './service.stack';

const app = new App();
const config = resolvePipelineConfig(app, 'investor-adpt');

new InvestorAdptStack(app, `${config.prefix}-investor-adpt`, {
  prefix: config.prefix,
  env: {
    account: config.account ?? process.env['CDK_DEFAULT_ACCOUNT'],
    region: config.region ?? process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
  },
});

app.synth();
```

- [ ] **Step 7: Add tsconfig path**

Add to `tsconfig.base.json` paths:
```json
"@nestfolio/investor-adpt/domain": ["services/investor/investor-adpt/src/domain/index.ts"]
```

- [ ] **Step 8: Commit**

```bash
git add services/investor/investor-adpt/
git commit -m "feat: create investor-adpt cross-domain adapter service"
```

### Task 4: Create advisory-adpt adapter service

**Files:**
- Create: `services/advisory/advisory-adpt/project.json`
- Create: `services/advisory/advisory-adpt/tsconfig.json`
- Create: `services/advisory/advisory-adpt/src/domain/index.ts`
- Create: `services/advisory/advisory-adpt/src/domain/events.ts`
- Create: `services/advisory/advisory-adpt/src/service.stack.ts`
- Create: `services/advisory/advisory-adpt/src/main.ts`
- Modify: `tsconfig.base.json` (add path)

- [ ] **Step 1: Create project.json**

Same pattern as Task 3, with:
- `"name": "advisory-adpt"`
- paths: `services/advisory/advisory-adpt/...`
- tags: `["scope:advisory", "type:adpt"]`

- [ ] **Step 2: Create tsconfig.json**

Same pattern, outDir: `../../../dist/services/advisory/advisory-adpt`

- [ ] **Step 3: Create domain events barrel**

Create `services/advisory/advisory-adpt/src/domain/events.ts`:
```ts
export const AdvisoryCrossDomainEventTypes = {
  // → Investor + Execution
  DECISION_PACKET_CREATED: 'DECISION_PACKET_CREATED',
  DECISION_APPROVED: 'DECISION_APPROVED',
  CIRCUIT_BREAKER_TRIGGERED: 'CIRCUIT_BREAKER_TRIGGERED',
  CIRCUIT_BREAKER_RESET: 'CIRCUIT_BREAKER_RESET',
  // → Investor only
  USER_CONFIRMATION_REQUESTED: 'USER_CONFIRMATION_REQUESTED',
  EXPLANATION_GENERATED: 'EXPLANATION_GENERATED',
  DECISION_BLOCKED: 'DECISION_BLOCKED',
  ESCALATION_TRIGGERED: 'ESCALATION_TRIGGERED',
  INCIDENT_DETECTED: 'INCIDENT_DETECTED',
  INCIDENT_RESOLVED: 'INCIDENT_RESOLVED',
  // → Execution only
  USER_CONFIRMED: 'USER_CONFIRMED',
} as const;

export type AdvisoryCrossDomainEventType =
  (typeof AdvisoryCrossDomainEventTypes)[keyof typeof AdvisoryCrossDomainEventTypes];
```

- [ ] **Step 4: Create domain index barrel**

Create `services/advisory/advisory-adpt/src/domain/index.ts`:
```ts
export { AdvisoryCrossDomainEventTypes } from './events';
export type { AdvisoryCrossDomainEventType } from './events';

// Re-export cross-domain types from internal services that external consumers need
export type {
  ProposedTrade, ComplianceCheck, DecisionStatus, ComplianceLevel, ComplianceResult,
} from '@nestfolio/advisory-ctrl/service';
```

- [ ] **Step 5: Create service.stack.ts**

Create `services/advisory/advisory-adpt/src/service.stack.ts` — same CDK pattern as investor-adpt:
- Resolve advisory bus from SSM
- ToInvestor rule: `DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, EXPLANATION_GENERATED, DECISION_APPROVED, DECISION_BLOCKED, ESCALATION_TRIGGERED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, INCIDENT_DETECTED, INCIDENT_RESOLVED`
- ToExecution rule: `DECISION_APPROVED, DECISION_PACKET_CREATED, USER_CONFIRMED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET`
- Each with DLQ

- [ ] **Step 6: Create main.ts**

Same pattern: `AdvisoryAdptStack`, config `'advisory-adpt'`.

- [ ] **Step 7: Add tsconfig path**

```json
"@nestfolio/advisory-adpt/domain": ["services/advisory/advisory-adpt/src/domain/index.ts"]
```

- [ ] **Step 8: Commit**

```bash
git add services/advisory/advisory-adpt/
git commit -m "feat: create advisory-adpt cross-domain adapter service"
```

### Task 5: Create execution-adpt adapter service (NEW, cross-domain)

**Files:**
- Create: `services/execution/execution-adpt/project.json`
- Create: `services/execution/execution-adpt/tsconfig.json`
- Create: `services/execution/execution-adpt/src/domain/index.ts`
- Create: `services/execution/execution-adpt/src/domain/events.ts`
- Create: `services/execution/execution-adpt/src/service.stack.ts`
- Create: `services/execution/execution-adpt/src/main.ts`
- Modify: `tsconfig.base.json` (add path)

Note: This is a NEW service. The old execution-adpt was renamed to broker-adpt in Task 1.

- [ ] **Step 1: Create project.json**

Same pattern with `"name": "execution-adpt"`, tags `["scope:execution", "type:adpt"]`.

- [ ] **Step 2: Create tsconfig.json**

Same pattern.

- [ ] **Step 3: Create domain events barrel**

Create `services/execution/execution-adpt/src/domain/events.ts`:
```ts
export const ExecutionCrossDomainEventTypes = {
  // → Investor
  ORDER_STAGED: 'ORDER_STAGED',
  ORDER_REJECTED: 'ORDER_REJECTED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  WITHDRAWAL_REJECTED: 'WITHDRAWAL_REJECTED',
  // → Ledger
  ORDER_FILLED: 'ORDER_FILLED',
  ORDER_PARTIALLY_FILLED: 'ORDER_PARTIALLY_FILLED',
  DEPOSIT_DETECTED: 'DEPOSIT_DETECTED',
  WITHDRAWAL_COMPLETED: 'WITHDRAWAL_COMPLETED',
  CORPORATE_ACTION_APPLIED: 'CORPORATE_ACTION_APPLIED',
  PORTFOLIO_SNAPSHOT_IMPORTED: 'PORTFOLIO_SNAPSHOT_IMPORTED',
  // → Advisory
  PORTFOLIO_DRIFT_DETECTED: 'PORTFOLIO_DRIFT_DETECTED',
  BROKER_SESSION_LOST: 'BROKER_SESSION_LOST',
  STREAM_DISCONNECTED: 'STREAM_DISCONNECTED',
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
} as const;

export type ExecutionCrossDomainEventType =
  (typeof ExecutionCrossDomainEventTypes)[keyof typeof ExecutionCrossDomainEventTypes];
```

- [ ] **Step 4: Create domain index barrel**

Create `services/execution/execution-adpt/src/domain/index.ts`:
```ts
export { ExecutionCrossDomainEventTypes } from './events';
export type { ExecutionCrossDomainEventType } from './events';

// Re-export cross-domain types from broker-adpt (external events)
export { ExecutionAdptEventTypes } from '@nestfolio/broker-adpt/service';
export type { ExecutionAdptEventType } from '@nestfolio/broker-adpt/service';
export type { OrderFilledEvent, DepositDetectedEvent } from '@nestfolio/broker-adpt/service';
```

- [ ] **Step 5: Create service.stack.ts**

Same CDK pattern:
- Resolve execution bus from SSM
- ToInvestor rule: `ORDER_STAGED, ORDER_REJECTED, ORDER_CANCELLED, WITHDRAWAL_REJECTED`
- ToLedger rule: `ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED`
- ToAdvisory rule: `ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, PORTFOLIO_DRIFT_DETECTED, BROKER_SESSION_LOST, STREAM_DISCONNECTED, RECONCILIATION_FAILED`
- Each with DLQ

- [ ] **Step 6: Create main.ts**

`ExecutionAdptStack`, config `'execution-adpt'`.

- [ ] **Step 7: Add tsconfig path**

```json
"@nestfolio/execution-adpt/domain": ["services/execution/execution-adpt/src/domain/index.ts"]
```

- [ ] **Step 8: Commit**

```bash
git add services/execution/execution-adpt/
git commit -m "feat: create execution-adpt cross-domain adapter service"
```

### Task 6: Create ledger-adpt adapter service

**Files:**
- Create: `services/ledger/ledger-adpt/project.json`
- Create: `services/ledger/ledger-adpt/tsconfig.json`
- Create: `services/ledger/ledger-adpt/src/domain/index.ts`
- Create: `services/ledger/ledger-adpt/src/domain/events.ts`
- Create: `services/ledger/ledger-adpt/src/service.stack.ts`
- Create: `services/ledger/ledger-adpt/src/main.ts`
- Modify: `tsconfig.base.json` (add path)

- [ ] **Step 1: Create project.json**

Same pattern with `"name": "ledger-adpt"`, tags `["scope:ledger", "type:adpt"]`.

- [ ] **Step 2: Create tsconfig.json**

Same pattern.

- [ ] **Step 3: Create domain events barrel**

Create `services/ledger/ledger-adpt/src/domain/events.ts`:
```ts
export const LedgerCrossDomainEventTypes = {
  // → Investor
  BALANCE_UPDATED: 'BALANCE_UPDATED',
  PORTFOLIO_UPDATED: 'PORTFOLIO_UPDATED',
  LEDGER_ENTRY_RECORDED: 'LEDGER_ENTRY_RECORDED',
  LEDGER_PROCESSING_FAILED: 'LEDGER_PROCESSING_FAILED',
  RECONCILIATION_COMPLETED: 'RECONCILIATION_COMPLETED',
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
  // → Advisory
  PORTFOLIO_DRIFT_DETECTED: 'PORTFOLIO_DRIFT_DETECTED',
} as const;

export type LedgerCrossDomainEventType =
  (typeof LedgerCrossDomainEventTypes)[keyof typeof LedgerCrossDomainEventTypes];
```

- [ ] **Step 4: Create domain index barrel**

Create `services/ledger/ledger-adpt/src/domain/index.ts`:
```ts
export { LedgerCrossDomainEventTypes } from './events';
export type { LedgerCrossDomainEventType } from './events';
```

- [ ] **Step 5: Create service.stack.ts**

Same CDK pattern:
- Resolve ledger bus from SSM
- ToInvestor rule: `BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, LEDGER_PROCESSING_FAILED`
- ToAdvisory rule: `PORTFOLIO_UPDATED, PORTFOLIO_DRIFT_DETECTED, RECONCILIATION_FAILED`
- Each with DLQ

- [ ] **Step 6: Create main.ts**

`LedgerAdptStack`, config `'ledger-adpt'`.

- [ ] **Step 7: Add tsconfig path**

```json
"@nestfolio/ledger-adpt/domain": ["services/ledger/ledger-adpt/src/domain/index.ts"]
```

- [ ] **Step 8: Run full test suite**

```bash
npx nx run-many -t test
```

Expected: all pass (adapter services have no tests yet, but all existing tests must still pass).

- [ ] **Step 9: Commit**

```bash
git add services/ledger/ledger-adpt/ tsconfig.base.json
git commit -m "feat: create ledger-adpt cross-domain adapter service"
```

---

## Chunk 4: Rewire cross-domain imports + strip hub forwarding rules

### Task 7: Rewire cross-domain imports to adapter /domain barrels

**Files:**
- Modify: all source files with cross-domain imports (~15 files)
- Modify: all jest.config.js with cross-domain moduleNameMapper entries (~10 files)

- [ ] **Step 1: Rewire investor-domain services (cross-domain imports)**

`services/investor/investor-ctrl/src/handlers/event-listener.ts`:
```ts
// Before
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/service';
import { ExecutionAdptEventTypes } from '@nestfolio/broker-adpt/service';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/service';
// After
import { AdvisoryCrossDomainEventTypes } from '@nestfolio/advisory-adpt/domain';
import { ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
```

Note: The switch/case event matching inside the handler must also be updated to use the new event type constant names (e.g., `ComplianceEventTypes.X` → `AdvisoryCrossDomainEventTypes.X`). Read the full event-listener handler to determine exact event names used.

`services/investor/investor-bff/src/handlers/event-listener.ts`:
```ts
// Before
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/service';
// After
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
```

`services/investor/dashboard-bff/src/handlers/event-listener.ts`:
```ts
// Before
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/service';
import { ReconciliationEventTypes } from '@nestfolio/reconciliation-ctrl/service';
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/service';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/service';
// After
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { AdvisoryCrossDomainEventTypes } from '@nestfolio/advisory-adpt/domain';
```

Note: `ReconciliationEventTypes` and `ComplianceEventTypes` must be mapped to the appropriate adapter cross-domain event type constants. Check which specific events are used and map to the correct `*CrossDomainEventTypes` constant.

- [ ] **Step 2: Rewire advisory-domain services (cross-domain imports)**

`services/advisory/advisory-ctrl/src/handlers/event-listener.ts`:
```ts
// Before (cross-domain — change these)
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/service';
import { ReconciliationEventTypes } from '@nestfolio/reconciliation-ctrl/service';
import { ExecutionAdptEventTypes } from '@nestfolio/broker-adpt/service';
// After
import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';

// Keep these (in-domain — advisory scope)
import { AdvisoryBffEventTypes } from '@nestfolio/advisory-bff/service';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/service';
```

`services/advisory/compliance-ctrl/src/handlers/event-listener.ts`:
```ts
// Before (cross-domain)
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/service';
// After
import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain';
```

`services/advisory/compliance-ctrl/src/rules/rule-engine.ts`:
```ts
// Before
import { MandateLevel } from '@nestfolio/investor-bff/service';
// After
import { MandateLevel } from '@nestfolio/investor-adpt/domain';
```

- [ ] **Step 3: Rewire execution-domain services (cross-domain imports)**

`services/execution/execution-ctrl/src/handlers/event-listener.ts`:
```ts
// Before
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/service';
import { AdvisoryBffEventTypes } from '@nestfolio/advisory-bff/service';
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/service';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/service';
// After
import { AdvisoryCrossDomainEventTypes } from '@nestfolio/advisory-adpt/domain';
import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain';
```

`services/execution/execution-ctrl/src/repositories/order.repository.ts`:
```ts
// Before
import type { ProposedTrade } from '@nestfolio/advisory-ctrl/service';
// After
import type { ProposedTrade } from '@nestfolio/advisory-adpt/domain';
```

Same change in `safety-checks.service.ts` and `order-lifecycle.service.ts`.

`services/execution/broker-adpt/src/handlers/event-listener.ts`:
```ts
// Before
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/service';
// After
import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain';
```

- [ ] **Step 4: Rewire ledger-domain services (cross-domain imports)**

`services/ledger/ledger-ctrl/src/handlers/event-listener.ts`:
```ts
// Before
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/service';
import { ExecutionAdptEventTypes } from '@nestfolio/broker-adpt/service';
// After
import { AdvisoryCrossDomainEventTypes } from '@nestfolio/advisory-adpt/domain';
import { ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';
```

`services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts`:
```ts
// Before
import { ExecutionAdptEventTypes } from '@nestfolio/broker-adpt/service';
// After
import { ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';
```

- [ ] **Step 5: Update all jest.config.js moduleNameMapper for cross-domain imports**

For each service, add adapter `/domain` mappers and remove old cross-domain `/service` mappers that are no longer imported. Keep in-domain `/service` mappers.

**`investor-ctrl/jest.config.js`:**
- Add: `'^@nestfolio/advisory-adpt/domain$'`, `'^@nestfolio/execution-adpt/domain$'`, `'^@nestfolio/ledger-adpt/domain$'`
- Remove: `'^@nestfolio/compliance-ctrl/service$'`, `'^@nestfolio/broker-adpt/service$'`
- Keep: `'^@nestfolio/investor-bff/service$'`

**`investor-bff/jest.config.js`:**
- Add: `'^@nestfolio/ledger-adpt/domain$'`
- Remove: `'^@nestfolio/ledger-ctrl/service$'`
- Keep: `'^@nestfolio/investor-ctrl/service$'`

**`dashboard-bff/jest.config.js`:**
- Add: `'^@nestfolio/ledger-adpt/domain$'`, `'^@nestfolio/advisory-adpt/domain$'`
- Remove: `'^@nestfolio/ledger-ctrl/service$'`, `'^@nestfolio/reconciliation-ctrl/service$'`, `'^@nestfolio/advisory-ctrl/service$'`, `'^@nestfolio/compliance-ctrl/service$'`
- Keep: `'^@nestfolio/investor-bff/service$'`

**`advisory-ctrl/jest.config.js`:**
- Add: `'^@nestfolio/investor-adpt/domain$'`, `'^@nestfolio/execution-adpt/domain$'`, `'^@nestfolio/ledger-adpt/domain$'`
- Remove: `'^@nestfolio/investor-bff/service$'`, `'^@nestfolio/broker-adpt/service$'`, `'^@nestfolio/reconciliation-ctrl/service$'`
- Keep: `'^@nestfolio/advisory-bff/service$'`, `'^@nestfolio/compliance-ctrl/service$'`

**`compliance-ctrl/jest.config.js`:**
- Add: `'^@nestfolio/investor-adpt/domain$'`
- Remove: `'^@nestfolio/investor-bff/service$'`
- Keep: `'^@nestfolio/advisory-ctrl/service$'`
- Note: compliance-ctrl event-listener.ts also imports InvestorBffEventTypes (cross-domain) — must rewire to InvestorCrossDomainEventTypes

**`execution-ctrl/jest.config.js`:**
- Add: `'^@nestfolio/advisory-adpt/domain$'`, `'^@nestfolio/investor-adpt/domain$'`
- Remove: `'^@nestfolio/compliance-ctrl/service$'`, `'^@nestfolio/advisory-bff/service$'`, `'^@nestfolio/advisory-ctrl/service$'`, `'^@nestfolio/investor-bff/service$'`

**`broker-adpt/jest.config.js`:**
- Add: `'^@nestfolio/investor-adpt/domain$'`
- Remove: `'^@nestfolio/investor-bff/service$'`
- Keep: `'^@nestfolio/execution-ctrl/service$'`

**`ledger-ctrl/jest.config.js`:**
- Add: `'^@nestfolio/advisory-adpt/domain$'`, `'^@nestfolio/execution-adpt/domain$'`
- Remove: `'^@nestfolio/advisory-ctrl/service$'`, `'^@nestfolio/broker-adpt/service$'`

**`reconciliation-ctrl/jest.config.js`:**
- Add: `'^@nestfolio/execution-adpt/domain$'`
- Remove: `'^@nestfolio/broker-adpt/service$'`
- Keep: `'^@nestfolio/ledger-ctrl/service$'`

Adapter domain mapper paths follow this pattern:
```js
'^@nestfolio/advisory-adpt/domain$': '<rootDir>/../../advisory/advisory-adpt/src/domain/index.ts',
'^@nestfolio/investor-adpt/domain$': '<rootDir>/../../investor/investor-adpt/src/domain/index.ts',
'^@nestfolio/execution-adpt/domain$': '<rootDir>/../../execution/execution-adpt/src/domain/index.ts',
'^@nestfolio/ledger-adpt/domain$': '<rootDir>/../../ledger/ledger-adpt/src/domain/index.ts',
```

- [ ] **Step 6: Update event type constant references in handler routing**

Handlers use event type constants in arrays/object literals for routing. After importing `*CrossDomainEventTypes`, update every reference. Here is the **complete mapping per file** (only cross-domain references change; in-domain ones stay):

**`investor-ctrl` event-listener.ts:**
```ts
ComplianceEventTypes.DECISION_APPROVED → AdvisoryCrossDomainEventTypes.DECISION_APPROVED
ExecutionAdptEventTypes.ORDER_FILLED → ExecutionCrossDomainEventTypes.ORDER_FILLED
LedgerCtrlEventTypes.BALANCE_UPDATED → LedgerCrossDomainEventTypes.BALANCE_UPDATED
// Keep in-domain: InvestorBffEventTypes.ONBOARDING_COMPLETED, .MANDATE_GRANTED, .GOAL_UPDATED, .DEPOSIT_INITIATED, .OPERATING_MODE_CHANGED
```

**`investor-bff` event-listener.ts:**
```ts
LedgerCtrlEventTypes.BALANCE_UPDATED → LedgerCrossDomainEventTypes.BALANCE_UPDATED
// Keep in-domain: InvestorBffEventTypes.USER_REGISTERED, InvestorCtrlEventTypes.NOTIFICATION_CREATED
```

**`dashboard-bff` event-listener.ts:**
```ts
LedgerCtrlEventTypes.BALANCE_UPDATED → LedgerCrossDomainEventTypes.BALANCE_UPDATED
LedgerCtrlEventTypes.PORTFOLIO_UPDATED → LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED
LedgerCtrlEventTypes.LEDGER_ENTRY_RECORDED → LedgerCrossDomainEventTypes.LEDGER_ENTRY_RECORDED
ReconciliationEventTypes.RECONCILIATION_COMPLETED → LedgerCrossDomainEventTypes.RECONCILIATION_COMPLETED
AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED → AdvisoryCrossDomainEventTypes.DECISION_PACKET_CREATED
AdvisoryCtrlEventTypes.USER_CONFIRMATION_REQUESTED → AdvisoryCrossDomainEventTypes.USER_CONFIRMATION_REQUESTED
ComplianceEventTypes.DECISION_APPROVED → AdvisoryCrossDomainEventTypes.DECISION_APPROVED
ComplianceEventTypes.DECISION_BLOCKED → AdvisoryCrossDomainEventTypes.DECISION_BLOCKED
// Keep in-domain: InvestorBffEventTypes.ONBOARDING_COMPLETED, .GOAL_SET, .GOAL_UPDATED, .RISK_PROFILE_SET, .RISK_PROFILE_UPDATED
```

**`advisory-ctrl` event-listener.ts:**
```ts
InvestorBffEventTypes.MANDATE_GRANTED → InvestorCrossDomainEventTypes.MANDATE_GRANTED
InvestorBffEventTypes.GOAL_UPDATED → InvestorCrossDomainEventTypes.GOAL_UPDATED
InvestorBffEventTypes.RISK_PROFILE_UPDATED → InvestorCrossDomainEventTypes.RISK_PROFILE_UPDATED
InvestorBffEventTypes.OPERATING_MODE_CHANGED → InvestorCrossDomainEventTypes.OPERATING_MODE_CHANGED
ReconciliationEventTypes.PORTFOLIO_DRIFT_DETECTED → LedgerCrossDomainEventTypes.PORTFOLIO_DRIFT_DETECTED
ExecutionAdptEventTypes.ORDER_FILLED → ExecutionCrossDomainEventTypes.ORDER_FILLED
ExecutionAdptEventTypes.ORDER_REJECTED → ExecutionCrossDomainEventTypes.ORDER_REJECTED
ExecutionAdptEventTypes.ORDER_CANCELLED → ExecutionCrossDomainEventTypes.ORDER_CANCELLED
ExecutionAdptEventTypes.DEPOSIT_DETECTED → ExecutionCrossDomainEventTypes.DEPOSIT_DETECTED
// Keep in-domain: ComplianceEventTypes.DECISION_APPROVED, .DECISION_BLOCKED, AdvisoryBffEventTypes.USER_CONFIRMED, .USER_REJECTED
```

**`compliance-ctrl` event-listener.ts:**
```ts
InvestorBffEventTypes.MANDATE_GRANTED → InvestorCrossDomainEventTypes.MANDATE_GRANTED
InvestorBffEventTypes.MANDATE_UPDATED → InvestorCrossDomainEventTypes.MANDATE_UPDATED
InvestorBffEventTypes.MANDATE_REVOKED → InvestorCrossDomainEventTypes.MANDATE_REVOKED
InvestorBffEventTypes.OPERATING_MODE_CHANGED → InvestorCrossDomainEventTypes.OPERATING_MODE_CHANGED
// Keep in-domain: AdvisoryCtrlEventTypes.*, ComplianceEventTypes.*
```

**`execution-ctrl` event-listener.ts:**
```ts
ComplianceEventTypes.DECISION_APPROVED → AdvisoryCrossDomainEventTypes.DECISION_APPROVED
AdvisoryBffEventTypes.USER_CONFIRMED → AdvisoryCrossDomainEventTypes.USER_CONFIRMED
AdvisoryCtrlEventTypes.CIRCUIT_BREAKER_TRIGGERED → AdvisoryCrossDomainEventTypes.CIRCUIT_BREAKER_TRIGGERED
AdvisoryCtrlEventTypes.CIRCUIT_BREAKER_RESET → AdvisoryCrossDomainEventTypes.CIRCUIT_BREAKER_RESET
InvestorBffEventTypes.ACCOUNT_CLOSURE_REQUESTED → InvestorCrossDomainEventTypes.ACCOUNT_CLOSURE_REQUESTED
```

**`broker-adpt` event-listener.ts:**
```ts
InvestorBffEventTypes.WITHDRAWAL_REQUESTED → InvestorCrossDomainEventTypes.WITHDRAWAL_REQUESTED
InvestorBffEventTypes.DEPOSIT_INITIATED → InvestorCrossDomainEventTypes.DEPOSIT_INITIATED
// Keep in-domain: ExecutionCtrlEventTypes.ORDER_SUBMITTED
```

**`ledger-ctrl` event-listener.ts:**
```ts
ExecutionAdptEventTypes.ORDER_FILLED → ExecutionCrossDomainEventTypes.ORDER_FILLED
ExecutionAdptEventTypes.ORDER_PARTIALLY_FILLED → ExecutionCrossDomainEventTypes.ORDER_PARTIALLY_FILLED
ExecutionAdptEventTypes.ORDER_REJECTED → ExecutionCrossDomainEventTypes.ORDER_REJECTED
ExecutionAdptEventTypes.ORDER_CANCELLED → ExecutionCrossDomainEventTypes.ORDER_CANCELLED
ExecutionAdptEventTypes.DEPOSIT_DETECTED → ExecutionCrossDomainEventTypes.DEPOSIT_DETECTED
ExecutionAdptEventTypes.WITHDRAWAL_COMPLETED → ExecutionCrossDomainEventTypes.WITHDRAWAL_COMPLETED
AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED → AdvisoryCrossDomainEventTypes.DECISION_PACKET_CREATED
```

**`reconciliation-ctrl` event-listener.ts:**
```ts
ExecutionAdptEventTypes.PORTFOLIO_SNAPSHOT_IMPORTED → ExecutionCrossDomainEventTypes.PORTFOLIO_SNAPSHOT_IMPORTED
// Keep in-domain: LedgerCtrlEventTypes.PORTFOLIO_UPDATED
// Note: 'CORPORATE_ACTION_APPLIED' is a string literal, no constant change needed
```

- [ ] **Step 6b: Update test files referencing cross-domain imports**

Test files (e.g., `test/event-listener.test.ts` for each service) may import or mock cross-domain types. Grep for any `@nestfolio/*/service` imports in test files that should now point to adapter `/domain` barrels, and update them. Also update any mock `jest.mock()` calls that reference the old import paths.

- [ ] **Step 7: Run full test suite**

```bash
npx nx run-many -t test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rewire cross-domain imports to adapter /domain barrels"
```

### Task 8: Remove forwarding rules from hub stacks

**Deploy ordering note:** When deploying to AWS, adapter stacks (Tasks 3-6) MUST be deployed BEFORE hub stacks are redeployed without forwarding rules. Otherwise there will be a gap where no forwarding rules exist. This is a deploy-time concern, not a code concern — the code changes are independent.

**Files:**
- Modify: `services/investor/investor-hub/src/service.stack.ts`
- Modify: `services/advisory/advisory-hub/src/service.stack.ts`
- Modify: `services/execution/execution-hub/src/service.stack.ts`
- Modify: `services/ledger/ledger-hub/src/service.stack.ts`

- [ ] **Step 1: Strip investor-hub forwarding rules**

Remove from `services/investor/investor-hub/src/service.stack.ts`:
- Lines 51-92: All cross-domain forwarding code (advisory bus ARN lookup, ToAdvisory rule+DLQ, execution bus ARN lookup, ToExecution rule+DLQ)
- Remove `Rule` from imports
- Remove `EventBus as EventBusTarget` from imports
- Remove `Queue, QueueEncryption` from imports (if no other usage)
- Update Monitoring + ServiceDashboard: remove DLQ references (`dlqs: []`)
- Remove unused `StringParameter` import for cross-domain bus ARN lookups (keep the one for BusArnParam)

Keep: bus creation, archive, SSM BusArnParam, CostControls, Monitoring (without DLQs), ServiceDashboard (without DLQs).

- [ ] **Step 2: Strip advisory-hub forwarding rules**

Remove from `services/advisory/advisory-hub/src/service.stack.ts`:
- Lines 63-114: All cross-domain forwarding code
- Update Monitoring + ServiceDashboard: `dlqs: []`
- Keep: bus, archive, SSM params (including Bedrock model SSM params)

- [ ] **Step 3: Strip execution-hub forwarding rules**

Remove from `services/execution/execution-hub/src/service.stack.ts`:
- Lines 44-119: All cross-domain forwarding code (3 rules + 3 DLQs)
- Update Monitoring + ServiceDashboard: `dlqs: []`

- [ ] **Step 4: Strip ledger-hub forwarding rules**

Remove from `services/ledger/ledger-hub/src/service.stack.ts`:
- Lines 44-89: All cross-domain forwarding code (2 rules + 2 DLQs)
- Update Monitoring + ServiceDashboard: `dlqs: []`

- [ ] **Step 5: Run full test suite**

```bash
npx nx run-many -t test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move cross-domain forwarding rules from hubs to adapter services"
```

---

## Chunk 5: Scope tag fixes + enforce-module-boundaries + verification

### Task 9: Fix scope tags

**Files:**
- Modify: `apps/ledger-mfe/project.json` — change `scope:execution` → `scope:ledger`
- Modify: `apps/dashboard-mfe/project.json` — change `scope:dashboard` → `scope:investor`
- Create: `services/advisory/advisory-ctrl/agents/decision-lifecycle/project.json` — add missing tags

- [ ] **Step 1: Fix ledger-mfe scope tag**

In `apps/ledger-mfe/project.json`:
```json
"tags": ["scope:ledger", "type:mfe"]
```

- [ ] **Step 2: Fix dashboard-mfe scope tag**

In `apps/dashboard-mfe/project.json`:
```json
"tags": ["scope:investor", "type:mfe"]
```

- [ ] **Step 3: Add decision-lifecycle-agent project.json**

Create `services/advisory/advisory-ctrl/agents/decision-lifecycle/project.json`:
```json
{
  "name": "decision-lifecycle-agent",
  "tags": ["scope:advisory", "type:agent"]
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: correct scope tags for ledger-mfe, dashboard-mfe, decision-lifecycle-agent"
```

### Task 10: Install @nx/devkit and configure enforce-module-boundaries

**Files:**
- Modify: `package.json` (add @nx/devkit)
- Modify: `eslint.config.js`

- [ ] **Step 1: Install @nx/devkit**

```bash
pnpm add -wD @nx/devkit@22.5.4
```

- [ ] **Step 2: Update eslint.config.js**

Replace the rules block in `eslint.config.js`:

```js
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const prettierConfig = require('eslint-config-prettier');
const nxPlugin = require('@nx/eslint-plugin');

module.exports = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    plugins: {
      '@nx': nxPlugin,
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: false,
          allow: [
            '@nestfolio/.+-adpt/domain',
            '@nestfolio/event-processor',
            '@nestfolio/agent-core',
          ],
          depConstraints: [
            { sourceTag: 'scope:platform', onlyDependOnLibsWithTags: ['scope:platform'] },
            { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared', 'scope:platform'] },
            { sourceTag: 'scope:domain', onlyDependOnLibsWithTags: ['scope:domain', 'scope:platform'] },
            { sourceTag: 'scope:investor', onlyDependOnLibsWithTags: ['scope:investor', 'scope:platform', 'scope:shared'] },
            { sourceTag: 'scope:advisory', onlyDependOnLibsWithTags: ['scope:advisory', 'scope:platform', 'scope:shared'] },
            { sourceTag: 'scope:execution', onlyDependOnLibsWithTags: ['scope:execution', 'scope:platform', 'scope:shared'] },
            { sourceTag: 'scope:ledger', onlyDependOnLibsWithTags: ['scope:ledger', 'scope:platform', 'scope:shared'] },
            { sourceTag: 'scope:shell', onlyDependOnLibsWithTags: ['scope:shell', 'scope:shared'] },
          ],
        },
      ],
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/tmp/**', '**/*.js', '!eslint.config.js'],
  },
];
```

- [ ] **Step 3: Commit**

```bash
git add eslint.config.js package.json pnpm-lock.yaml
git commit -m "feat: configure enforce-module-boundaries with two-level domain isolation"
```

### Task 11: Verify — zero boundary violations

- [ ] **Step 1: Run lint across all projects**

```bash
npx nx run-many -t lint
```

Expected: zero `@nx/enforce-module-boundaries` violations. Pre-existing lint errors (no-console, no-explicit-any) are acceptable.

- [ ] **Step 2: If boundary violations found, fix them**

Common fixes:
- Missing adapter barrel export → add to `*-adpt/domain/index.ts`
- Wrong import path → switch `/service` to adapter `/domain` or vice versa
- Missing jest.config.js mapper → add `moduleNameMapper` entry

- [ ] **Step 3: Run full test suite**

```bash
npx nx run-many -t test
```

Expected: all projects pass.

- [ ] **Step 4: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix: resolve remaining module boundary violations"
```
