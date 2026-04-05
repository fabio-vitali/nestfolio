# Per-Service Integration Tests — Design Spec

**Date:** 2026-04-05
**Status:** Draft
**Scope:** Integration test framework for BFF, CTRL, and ADPT service patterns against deployed dev environment

## Goal

Systematically verify that each service's deployed infrastructure works end-to-end: events are routed by EventBridge rules, handlers process them, DynamoDB state changes occur, and CDC events are emitted. Tests run against the real deployed dev environment (account 771924376645, us-east-1) using the current Leapp session.

## Non-Goals

- End-to-end flow tests spanning multiple services (separate initiative)
- Load/performance testing
- Frontend/UI testing
- Testing services that are not yet deployed

---

## Side-Effect Isolation: Target-Aware Source Filtering

Integration tests must not trigger side-effects in non-target services. This is achieved through a two-layer filtering mechanism.

### Layer 1: Target-Aware EB Rule Source Filter

Every service's EventBridge rule (Ingress construct + ADPT stacks) adds a `source` filter that:
1. Passes **all normal events** (source doesn't start with `integration-test:`)
2. Passes **test events targeting this specific service** (source starts with `integration-test:{self}`)
3. Rejects **test events targeting other services**

```typescript
// Ingress construct — updated event pattern
new Rule(this, 'Rule', {
  eventBus,
  eventPattern: {
    detailType: props.eventTypes,
    source: [
      { 'anything-but': { prefix: 'integration-test:' } },
      { prefix: `integration-test:${serviceName}` },
    ],
  },
  targets: [new SqsQueue(this.queue)],
});
```

**How it works for a CTRL test publishing `source: "integration-test:investor-ctrl"`:**

| Service rule | Condition 1 (anything-but) | Condition 2 (prefix match) | Result |
|---|---|---|---|
| investor-ctrl | FALSE (starts with `integration-test:`) | TRUE (`integration-test:investor-ctrl`) | **PASS** |
| investor-bff | FALSE | FALSE (`integration-test:investor-bff` ≠ prefix) | **FILTERED** |
| dashboard-bff | FALSE | FALSE | **FILTERED** |

ADPT stacks get the same pattern on each of their EB rules:

```typescript
// investor-adpt — updated FromExecution rule
new Rule(this, 'InvestorIngress-FromExecution', {
  eventBus: executionBus,
  eventPattern: {
    detailType: [...],
    source: [
      { 'anything-but': { prefix: 'integration-test:' } },
      { prefix: `integration-test:${serviceName}` },  // "integration-test:investor-adpt"
    ],
  },
  targets: [new EventBusTarget(investorBus, { deadLetterQueue: fromExecutionDlq })],
});
```

### Layer 2: CDC Source Tagging for Test Tenants

When a service processes a test event and writes to DynamoDB, the CDC Lambda fires and publishes the resulting event to EventBridge. Without intervention, this CDC event has a normal `Source` (`{busName}@{serviceName}`) and would pass through other services' `anything-but` filter, causing cascading side-effects.

**Solution:** Modify the `changeDataCapture` pipeline to detect test tenants and tag CDC events accordingly.

In `libs/event-processor/src/pipelines/change-data-capture.ts`, the `buildEntry` function is updated:

```typescript
function buildEntry(
  record: StreamRecord,
  ctx: StreamContext,
  eventType: string,
  busName: string,
  serviceName: string,
  transform?: ChangeDataCaptureConfig['transform'],
): PutEventsRequestEntry {
  const detail = {
    id: ctx.record.eventID ?? getUUID(),
    type: eventType,
    timestamp: new Date().toISOString(),
    subject: transform ? transform(record, eventType) : record,
    context: {
      tenantId: record.tenantId,
      userId: record.userId,
      region: record.region,
    },
  };

  // Tag CDC events from test tenants so other services' EB rules filter them out
  const isTestTenant = record.tenantId?.startsWith('integ-');
  const source = isTestTenant
    ? `integration-test:${serviceName}`
    : `${busName}@${serviceName}`;

  return {
    EventBusName: busName,
    Source: source,
    DetailType: eventType,
    Detail: JSON.stringify(detail),
  };
}
```

**Full isolation chain for a BFF test:**
```
GraphQL mutation (authenticated, tenantId: integ-1712345678901)
  → AppSync → DDB write (Deposit record with tenantId: integ-...)
  → DDB Stream → CDC Lambda
  → CDC detects integ- prefix → publishes Source: "integration-test:investor-bff"
  → EventBusTrap catches it (no anything-but filter) ✓
  → investor-ctrl rule: anything-but → FALSE, prefix investor-ctrl → FALSE → FILTERED ✓
  → execution-adpt rule: anything-but → FALSE, prefix execution-adpt → FALSE → FILTERED ✓
```

### Infrastructure Changes Required

| Change | File | Impact |
|--------|------|--------|
| Add `source` filter to Ingress construct | `libs/cdk-constructs/src/core/ingress.ts` | All services using Ingress |
| Add `source` filter to each ADPT stack | `services/*/\*-adpt/src/service.stack.ts` | 4 adapter stacks |
| Add CDC test-tenant tagging | `libs/event-processor/src/pipelines/change-data-capture.ts` | All CDC Lambdas |
| Add `adminUserPassword` to Cognito client | `services/investor/investor-web/src/service.stack.ts` | Cognito config |
| Redeploy all affected services | — | One-time deploy after CDK changes |

---

## Architecture

### Test Topology Per Pattern

```
BFF:   GraphQL mutation ──► AppSync ──► DDB write ──► DDB Stream ──► CDC Lambda ──► EventBridge
       (authenticated)                                                              ▲
                                                                              EB Trap asserts

CTRL:  EB PutEvents ──► EB Rule ──► SQS ──► Lambda ──► DDB write ──► DDB Stream ──► CDC Lambda ──► EventBridge
       (test publishes                                                                              ▲
        to domain bus)                                                                        EB Trap asserts

ADPT:  EB PutEvents ──► EB Rule (source bus) ──► target bus
       (test publishes                              ▲
        to source bus)                        EB Trap asserts
```

### Directory Structure

```
libs/integration-testing/              ← shared Nx library
  src/
    index.ts                           ← public API barrel
    context.ts                         ← IntegrationContext factory
    fixtures/
      cognito.fixture.ts               ← Cognito test user lifecycle
      event-bus-trap.fixture.ts         ← temporary EB rule + SQS queue
      table-assertions.ts              ← DDB polling/assertions
      appsync-client.ts                ← authenticated GraphQL client
      event-bridge-client.ts           ← publish events to EB
    cleanup.ts                         ← cleanup registry
    ssm-cache.ts                       ← SSM parameter cache
  project.json
  tsconfig.json
  jest.config.js

services/{domain}/{service}/
  test/
    unit/                              ← existing tests (moved from test/)
      ...existing test files...
    integration/
      {test-name}.integration.test.ts
  jest.config.js                       ← updated: testMatch for unit/
  jest.integration.config.js           ← new: testMatch for integration/
  project.json                         ← new target: test:integration
```

---

## Shared Library: `libs/integration-testing`

### 1. IntegrationContext

Central factory that bootstraps a test run. All fixtures receive this context.

```typescript
interface IntegrationContext {
  /** Unique per-run tenant: "integ-{timestamp}" */
  tenantId: string;
  /** Unique per-run user: "integ-user-{timestamp}" */
  userId: string;
  /** Environment prefix (default: "dev") */
  prefix: string;
  /** AWS region (default: "us-east-1") */
  region: string;
  /** Pre-resolved SSM values */
  ssm: SsmCache;
  /** Cleanup registry — all fixtures register here */
  cleanup: CleanupRegistry;
}

function createIntegrationContext(options?: {
  prefix?: string;
  region?: string;
}): Promise<IntegrationContext>;
```

**Tenant ID format:** `integ-{Date.now()}` — unique per run, easily identifiable as test data, sortable by time.

### 2. SSM Cache (`SsmCache`)

Resolves and caches SSM parameters once per test run. Provides typed accessors for common resources.

```typescript
class SsmCache {
  /** Bus ARN: /nestfolio/{prefix}-{subsystem}/event-hub/busArn */
  busArn(subsystem: string): Promise<string>;

  /** Table name: deterministic "{prefix}-{service}-table" — no SSM needed */
  tableName(service: string): string;

  /** GraphQL URL: /nestfolio/{prefix}-{service}/api/graphqlUrl */
  graphqlUrl(service: string): Promise<string>;

  /** Cognito User Pool ID: /nestfolio/{prefix}-investor/auth/userPoolId */
  userPoolId(): Promise<string>;

  /** Cognito Client ID: /nestfolio/{prefix}-investor/auth/userPoolClientId */
  userPoolClientId(): Promise<string>;
}
```

Table names follow `{prefix}-{service}-table` deterministically (from `NamingService.tableName()`), so no SSM lookup is needed for DDB.

### 3. CognitoFixture

Manages test user lifecycle. Used only by BFF tests that need authenticated GraphQL access.

```typescript
class CognitoFixture {
  constructor(ctx: IntegrationContext);

  /** Creates test user in Cognito, returns JWT tokens */
  setup(): Promise<CognitoTokens>;

  /** Deletes test user */
  teardown(): Promise<void>;
}

interface CognitoTokens {
  idToken: string;
  accessToken: string;
}
```

**Implementation details:**
- `AdminCreateUser` with `custom:tenant_id` = `ctx.tenantId`, email = `integ-{timestamp}@test.nestfolio.dev`
- `AdminSetUserPassword` to set a known password (bypasses email verification)
- `AdminInitiateAuth` with `ALLOW_ADMIN_USER_PASSWORD_AUTH` flow to get tokens
- User Pool ID and Client ID resolved from SSM: `/nestfolio/{prefix}-investor/auth/userPoolId` and `auth/userPoolClientId`
- Registers `AdminDeleteUser` in cleanup registry

**Pre-requisite:** The Cognito User Pool client must have `ALLOW_ADMIN_USER_PASSWORD_AUTH` enabled. Current config has `userPassword: true` which maps to `ALLOW_USER_PASSWORD_AUTH`. We need to verify if `AdminInitiateAuth` works with the current client config, or if we need to add `ALLOW_ADMIN_USER_PASSWORD_AUTH` to the investor-web stack's client config. Alternative: use `InitiateAuth` with `USER_PASSWORD_AUTH` flow (no admin API, works with current config).

### 4. AppSyncClient

Authenticated GraphQL client for BFF tests.

```typescript
class AppSyncClient {
  constructor(ctx: IntegrationContext, tokens: CognitoTokens);

  /** Execute a GraphQL query */
  query<T>(operation: string, variables?: Record<string, unknown>): Promise<T>;

  /** Execute a GraphQL mutation */
  mutate<T>(operation: string, variables?: Record<string, unknown>): Promise<T>;
}
```

**Implementation:** Simple HTTP POST to the AppSync GraphQL URL with `Authorization: {idToken}` header. No Amplify dependency needed — raw `fetch` with the JWT.

### 5. EventBridgeClient

Publishes events to a domain bus, simulating upstream services. Automatically sets the target-aware source for test isolation.

```typescript
class EventBridgeClient {
  constructor(ctx: IntegrationContext);

  /** Publish an event to a domain bus with target-aware source */
  putEvent(params: {
    bus: string;          // subsystem name: "investor", "execution", etc.
    targetService: string; // target service name: "investor-ctrl", "investor-adpt", etc.
    detailType: string;   // e.g., "ONBOARDING_COMPLETED"
    detail: Record<string, unknown>;
  }): Promise<void>;
}
```

**Implementation:** Resolves bus ARN from SSM, uses `@aws-sdk/client-eventbridge` PutEvents. Sets `Source` to `integration-test:{targetService}` so only the target service's EB rule passes the event through.

The event `Detail` must match the ingestion engine's expected structure (from `parseSqsRecord`):
```json
{
  "id": "integ-{uuid}",
  "type": "ONBOARDING_COMPLETED",
  "timestamp": "2026-04-05T12:00:00Z",
  "subject": { ...caller-provided detail fields... },
  "context": {
    "tenantId": "integ-1712345678901",
    "userId": "integ-user-1712345678901",
    "region": "us-east-1"
  }
}
```

The `putEvent` method wraps the caller's `detail` into `subject` and auto-populates `id`, `type`, `timestamp`, and `context` from the IntegrationContext. This matches the CDC event structure produced by `buildEntry` in `change-data-capture.ts`.

### 6. EventBusTrap

Temporary EventBridge rule + SQS queue that captures events for assertion. This is the key component for verifying CDC output.

```typescript
class EventBusTrap {
  constructor(ctx: IntegrationContext);

  /**
   * Deploy a trap: creates SQS queue + EB rule filtering on detailType and tenantId.
   * Must be called BEFORE the action that triggers the event.
   */
  deploy(params: {
    bus: string;             // subsystem name
    detailType: string | string[];  // event type(s) to capture
  }): Promise<void>;

  /**
   * Wait for an event matching the filter. Polls SQS with long-polling.
   * Returns the event detail or throws on timeout.
   */
  waitForEvent(params?: {
    detailType?: string;     // filter within captured events (if trap catches multiple types)
    timeoutMs?: number;      // default: 30_000
    pollIntervalMs?: number; // default: 2_000
  }): Promise<CapturedEvent>;

  /**
   * Return all captured events (non-blocking).
   */
  drain(): Promise<CapturedEvent[]>;

  /** Delete the SQS queue and EB rule */
  teardown(): Promise<void>;
}

interface CapturedEvent {
  detailType: string;
  detail: Record<string, unknown>;
  source: string;
  time: string;
}
```

**Implementation details:**
- **SQS Queue:** Created with `CreateQueue`, name = `integ-trap-{timestamp}-{random}`, 60s visibility timeout, 5-minute retention (short-lived)
- **EB Rule:** Created with `PutRule` on the target bus, event pattern:
  ```json
  {
    "detail-type": ["DEPOSIT_INITIATED"],
    "detail": { "tenantId": ["integ-1712345678901"] }
  }
  ```
  Target = the SQS queue via `PutTargets`
- **SQS Policy:** Queue policy allowing EventBridge to send messages (`sqs:SendMessage` with condition on the rule ARN)
- **Polling:** `ReceiveMessage` with `WaitTimeSeconds: 5` (SQS long poll), looped until event found or timeout
- **Teardown:** `DeleteRule` (remove targets first) + `DeleteQueue`. Registered in cleanup registry.

**Lifecycle note:** The trap MUST be deployed before the triggering action. EB rules take ~1-2s to become active. The `deploy()` method includes a small safety delay (2s) after rule creation before returning.

### 7. TableAssertions

DynamoDB polling and assertion utilities.

```typescript
class TableAssertions {
  constructor(ctx: IntegrationContext);

  /**
   * Poll DDB until an item matching pk/sk appears. Returns the item.
   * Throws on timeout.
   */
  waitForItem(params: {
    table: string;           // service name (resolved to "{prefix}-{service}-table")
    pk: string;
    sk?: string;             // if omitted, any sk under pk matches
    timeoutMs?: number;      // default: 30_000
    pollIntervalMs?: number; // default: 2_000
  }): Promise<Record<string, unknown>>;

  /**
   * Assert an item's attributes match expectations.
   */
  assertItem(params: {
    table: string;
    pk: string;
    sk: string;
    expect: Record<string, unknown>;  // partial match
  }): Promise<void>;

  /**
   * Query all items for a pk (or pk prefix). Used for cleanup and multi-item assertions.
   */
  queryItems(params: {
    table: string;
    pk: string;
    skPrefix?: string;
  }): Promise<Record<string, unknown>[]>;

  /**
   * Delete all items matching a pk. Used in teardown.
   */
  cleanup(params: {
    table: string;
    pk: string;
  }): Promise<void>;
}
```

### 8. CleanupRegistry

Ensures all AWS resources created during a test run are deleted, even if tests fail.

```typescript
class CleanupRegistry {
  /** Register a cleanup action. Executed in LIFO order. */
  register(name: string, fn: () => Promise<void>): void;

  /** Run all cleanups. Called in afterAll(). Logs errors but does not throw. */
  runAll(): Promise<void>;
}
```

---

## Test Patterns

### BFF Integration Test (investor-bff)

**File:** `services/investor/investor-bff/test/integration/initiate-deposit.integration.test.ts`

```typescript
import {
  createIntegrationContext,
  CognitoFixture,
  AppSyncClient,
  EventBusTrap,
  TableAssertions,
} from '@nestfolio/integration-testing';

describe('investor-bff: initiateDeposit', () => {
  let ctx: IntegrationContext;
  let cognito: CognitoFixture;
  let appsync: AppSyncClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    cognito = new CognitoFixture(ctx);
    const tokens = await cognito.setup();
    appsync = new AppSyncClient(ctx, tokens);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);

    // Deploy trap BEFORE the mutation (captures DEPOSIT_INITIATED on InvestorBus)
    await trap.deploy({
      bus: 'investor',
      detailType: 'DEPOSIT_INITIATED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should create deposit record and emit DEPOSIT_INITIATED', async () => {
    // Act: authenticated GraphQL mutation
    const result = await appsync.mutate(`
      mutation InitiateDeposit($input: InitiateDepositInput!) {
        initiateDeposit(input: $input) { depositId status }
      }
    `, {
      input: { amountCents: 100_000, currency: 'USD' },
    });

    expect(result.initiateDeposit.status).toBe('INITIATED');

    // Assert: DDB state
    const item = await table.waitForItem({
      table: 'investor-bff',
      pk: `InvestorProfile#${ctx.tenantId}#${ctx.userId}`,
      sk: `Deposit#`,  // sk prefix
    });
    expect(item.amountCents).toBe(100_000);

    // Assert: CDC event on EventBridge
    const event = await trap.waitForEvent();
    expect(event.detailType).toBe('DEPOSIT_INITIATED');
    expect(event.detail.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
```

### CTRL Integration Test (investor-ctrl)

**File:** `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts`

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
} from '@nestfolio/integration-testing';

describe('investor-ctrl: ONBOARDING_COMPLETED notification', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);

    // Trap NOTIFICATION_CREATED on InvestorBus
    await trap.deploy({
      bus: 'investor',
      detailType: 'NOTIFICATION_CREATED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should create welcome notification on ONBOARDING_COMPLETED', async () => {
    // Act: publish to InvestorBus (tests EB rule → SQS → Lambda → DDB → CDC)
    // source: "integration-test:investor-ctrl" — only investor-ctrl's rule passes this through
    // detail is the "subject" payload — context (tenantId, userId, region) auto-injected
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-ctrl',
      detailType: 'ONBOARDING_COMPLETED',
      detail: {
        goal: 'RETIREMENT',
        riskTolerance: 'MODERATE',
      },
    });

    // Assert: Notification record in DDB
    const item = await table.waitForItem({
      table: 'investor-ctrl',
      pk: `Notification#${ctx.tenantId}#${ctx.userId}`,
    });
    expect(item.title).toContain('Welcome');

    // Assert: CDC event emitted
    const event = await trap.waitForEvent();
    expect(event.detailType).toBe('NOTIFICATION_CREATED');
    expect(event.detail.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
```

### ADPT Integration Test (investor-adpt)

**File:** `services/investor/investor-adpt/test/integration/from-execution.integration.test.ts`

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
} from '@nestfolio/integration-testing';

describe('investor-adpt: Execution → Investor forwarding', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    // Trap on InvestorBus — event should arrive here after forwarding
    await trap.deploy({
      bus: 'investor',
      detailType: 'ORDER_REJECTED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward ORDER_REJECTED from ExecutionBus to InvestorBus', async () => {
    // Act: publish to ExecutionBus (source bus)
    // source: "integration-test:investor-adpt" — only investor-adpt's rule on ExecutionBus passes this
    // detail is the "subject" payload — context (tenantId, userId, region) auto-injected
    await eb.putEvent({
      bus: 'execution',
      targetService: 'investor-adpt',
      detailType: 'ORDER_REJECTED',
      detail: {
        orderId: `integ-order-${Date.now()}`,
        reason: 'SAFETY_CHECK_FAILED',
      },
    });

    // Assert: event lands on InvestorBus (proves EB rule forwarding works)
    const event = await trap.waitForEvent();
    expect(event.detailType).toBe('ORDER_REJECTED');
    expect(event.detail.tenantId).toBe(ctx.tenantId);
    expect(event.detail.orderId).toContain('integ-order-');
  }, 60_000);
});
```

---

## Nx Configuration

### New target for each service: `test:integration`

Added to every service's `project.json`:

```json
{
  "test:integration": {
    "executor": "@nx/jest:jest",
    "options": {
      "jestConfig": "services/{domain}/{service}/jest.integration.config.js"
    }
  }
}
```

### Jest integration config (per service)

```javascript
// jest.integration.config.js
const preset = require('../../../jest.preset');
module.exports = {
  ...preset,
  displayName: '{service}-integration',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.integration.test.ts'],
  moduleNameMapper: {
    '^@nestfolio/integration-testing$': '<rootDir>/../../../libs/integration-testing/src/index.ts',
    '^@nestfolio/integration-testing/(.*)$': '<rootDir>/../../../libs/integration-testing/src/$1',
  },
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  // Longer timeouts for real AWS calls
  testTimeout: 120_000,
};
```

### Updated unit test config

Existing `jest.config.js` updated to scope to `test/unit/`:

```javascript
// jest.config.js (updated)
module.exports = {
  ...preset,
  displayName: '{service}',
  testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
  // ... rest unchanged
};
```

### Run commands

```bash
# Run integration tests for one service
pnpm nx test:integration investor-bff

# Run all integration tests
pnpm nx run-many -t test:integration

# Run affected integration tests
pnpm nx affected -t test:integration
```

---

## Existing Unit Test Migration

All existing test files move from `test/` to `test/unit/`:

```
test/handlers/event-listener.test.ts  →  test/unit/handlers/event-listener.test.ts
test/transforms/foo.test.ts           →  test/unit/transforms/foo.test.ts
test/repositories/bar.test.ts         →  test/unit/repositories/bar.test.ts
test/service.stack.test.ts            →  test/unit/service.stack.test.ts
```

Jest config `testMatch` updated to `test/unit/**/*.test.ts`. No test code changes needed.

---

## IAM / Permissions

Integration tests run under the Leapp-assumed admin role. The following permissions are needed (all available via AdminRole):

| Action | Resource | Used By |
|--------|----------|---------|
| `events:PutEvents` | Domain event buses | EventBridgeClient |
| `events:PutRule`, `events:PutTargets`, `events:DeleteRule`, `events:RemoveTargets` | Domain event buses | EventBusTrap |
| `sqs:CreateQueue`, `sqs:DeleteQueue`, `sqs:ReceiveMessage`, `sqs:SetQueueAttributes`, `sqs:GetQueueAttributes` | Trap queues | EventBusTrap |
| `dynamodb:GetItem`, `dynamodb:Query`, `dynamodb:DeleteItem` | Service tables | TableAssertions |
| `ssm:GetParameter` | `/nestfolio/dev-*` | SsmCache |
| `cognito-idp:AdminCreateUser`, `cognito-idp:AdminSetUserPassword`, `cognito-idp:AdminDeleteUser`, `cognito-idp:AdminInitiateAuth` | User Pool | CognitoFixture |

---

## Cognito Auth Flow

The current investor-web Cognito client has `userPassword: true` (`ALLOW_USER_PASSWORD_AUTH`). For integration tests we need `AdminInitiateAuth` with `ALLOW_ADMIN_USER_PASSWORD_AUTH` to avoid email verification.

**Decision:** Add `ALLOW_ADMIN_USER_PASSWORD_AUTH` to the investor-web stack's client config. This is a non-breaking change — it adds an auth flow without removing existing ones. Only the admin SDK can use this flow, so no security impact.

```typescript
// investor-web/src/service.stack.ts — add to client config:
const client = userPool.addClient('WebClient', {
  authFlows: {
    userPassword: true,
    userSrp: true,
    adminUserPassword: true,  // ← add for integration tests
  },
  generateSecret: false,
});
```

**CognitoFixture flow:**
1. `AdminCreateUser` — creates user with `custom:tenant_id` and `email` attributes, `MessageAction: SUPPRESS` (no verification email)
2. `AdminSetUserPassword` — sets permanent password, bypassing FORCE_CHANGE_PASSWORD
3. `AdminInitiateAuth` — `AuthFlow: ADMIN_USER_PASSWORD_AUTH`, returns ID + Access tokens
4. Teardown: `AdminDeleteUser`

---

## EventBusTrap Detail: Event Pattern & Tenant Scoping

The EB rule pattern filters on both `detail-type` AND `detail.context.tenantId` to ensure test isolation (matching the CDC event structure where tenantId is nested under `context`):

```json
{
  "detail-type": ["DEPOSIT_INITIATED"],
  "detail": {
    "context": {
      "tenantId": ["integ-1712345678901"]
    }
  }
}
```

This guarantees:
- Each test run only sees its own events (no cross-run interference)
- No interference with production or other dev traffic
- Multiple test runs can execute in parallel safely

---

## Timeouts & Polling

| Operation | Expected Latency | Default Timeout | Poll Interval |
|-----------|-----------------|-----------------|---------------|
| EB Rule activation | 1-3s | 2s wait after create | — |
| SQS → Lambda → DDB | 2-5s | 30s | 2s |
| DDB Stream → CDC Lambda → EB | 2-10s | 30s | 2s |
| Full CTRL pipeline (EB → SQS → DDB → CDC → EB) | 5-15s | 60s | 2s |
| Full BFF pipeline (GraphQL → DDB → CDC → EB) | 3-10s | 60s | 2s |
| ADPT forwarding (EB rule → EB) | 1-5s | 30s | 2s |
| Cognito user creation | 1-3s | 10s | — |

Jest `testTimeout` set to 120s per test file to account for `beforeAll` setup + test execution.

---

## Cleanup Strategy

Cleanup is critical to avoid resource leaks (especially EB rules and SQS queues).

**Layered approach:**
1. **CleanupRegistry** — each fixture registers its cleanup in `beforeAll`. `afterAll` calls `runAll()`.
2. **Jest `--forceExit`** — ensures process exits even if cleanup hangs.
3. **Naming convention** — all trap resources prefixed with `integ-trap-` for manual identification/cleanup.
4. **Stale resource sweeper** (future) — optional script that deletes `integ-trap-*` SQS queues and EB rules older than 1 hour.

---

## Starter Services

Initial implementation covers 3 services as proof of concept:

| Service | Pattern | Test Scenario |
|---------|---------|---------------|
| `investor-bff` | BFF | `initiateDeposit` mutation → Deposit record → DEPOSIT_INITIATED CDC |
| `investor-ctrl` | CTRL | ONBOARDING_COMPLETED event → Notification record → NOTIFICATION_CREATED CDC |
| `investor-adpt` | ADPT | ORDER_REJECTED on ExecutionBus → forwarded to InvestorBus |

---

## Implementation Order

### Phase 1: Infrastructure (CDK changes + deploy)
1. Add target-aware `source` filter to Ingress construct (`ingress.ts`)
2. Add target-aware `source` filter to all 4 ADPT stacks
3. Add CDC test-tenant source tagging to `change-data-capture.ts`
4. Add `adminUserPassword: true` to investor-web Cognito client config
5. Add Parameters and Secrets Extension to broker-alpaca-adpt stack (Ingress Lambda + poll Lambdas)
6. Create SSM parameter + Secrets Manager secret for Alpaca config
7. Refactor `AlpacaClient` to lazy-init from extension's localhost endpoint
8. Deploy all affected services (`pnpm nx run-many -t deploy --prefix=dev`)

### Phase 2: Test infrastructure
9. Create `libs/integration-testing` Nx library with shared fixtures
10. Implement core fixtures (IntegrationContext, CleanupRegistry, SsmCache)
11. Implement base fixtures (EventBusTrap, EventBridgeClient, TableAssertions, CognitoFixture, AppSyncClient)
12. Implement new fixtures (MockApiFixture, SsmOverrideFixture)
13. Implement mock-alpaca handler + esbuild zip target
14. Move existing unit tests to `test/unit/` for all 4 starter services
15. Update `jest.config.js` testMatch for unit tests
16. Create `jest.integration.config.js` for each service
17. Add `test:integration` target to each service's `project.json`

### Phase 3: Integration tests
18. Write integration tests for investor-adpt (simplest — no state, no auth)
19. Write integration tests for investor-ctrl (state verification, no auth)
20. Write integration tests for investor-bff (full: auth + state + CDC)
21. Write integration tests for broker-alpaca-adpt (full pipeline: mock API + DDB + CDC + SF polling)
22. Verify all tests pass against deployed dev environment

---

## Third-Party Adapter Pattern (3P-ADPT): `broker-alpaca-adpt`

### What Makes It Different

The existing patterns (BFF, CTRL, cross-domain ADPT) don't involve external API dependencies. `broker-alpaca-adpt` introduces a **fourth pattern: third-party API adapter (3P-ADPT)**:

| Aspect | Cross-domain ADPT (investor-adpt) | Third-party ADPT (broker-alpaca-adpt) |
|--------|-----------------------------------|---------------------------------------|
| Logic | Zero — pure EB rule forwarding | Full event-processor pipeline + service layer |
| State | None | DynamoDB (order/transfer mappings) |
| External dependency | None | Alpaca HTTP API |
| CDC output | None | Yes — status-mapped events (PLACED, FILLED, etc.) |
| Orchestration | None | 2 SF state machines (order polling, transfer polling) |
| Test complexity | EB → EB (one hop) | EB → SQS → Lambda → HTTP → DDB → CDC → SF → HTTP → DDB → CDC (multi-hop with external API) |

### Test Topology

```
EB PutEvents ──► EB Rule ──► SQS ──► Lambda ──► Mock API ──► DDB write ──► DDB Stream ──► CDC ──► EventBridge
(test publishes                                  (ephemeral                 (order                    ▲
 to ExecutionBus)                                 mock Lambda)              mapping)            EB Trap asserts
                                                                                              ALPACA_ORDER_PLACED
                                                                                                      │
                                                                                                      ▼
                                                                                               SF starts (triggered
                                                                                               by Orchestration EB rule)
                                                                                                      │
                                                                                               Wait → Poll Lambda → Mock API
                                                                                                      │
                                                                                               DDB update → CDC → EventBridge
                                                                                                                     ▲
                                                                                                              EB Trap asserts
                                                                                                              ALPACA_ORDER_FILLED
```

---

### Parameters and Secrets Lambda Extension

All third-party adapter services resolve external API config at **runtime** via the [AWS Parameters and Secrets Lambda Extension](https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-integration-lambda-extensions.html) — never from baked-in environment variables.

CDK has first-class support via `ParamsAndSecretsLayerVersion` (in `aws-cdk-lib/aws-lambda` since v2.75.0). The construct automatically adds the AWS-managed layer, sets extension env vars, and grants IAM permissions.

**SSM/Secrets layout for broker-alpaca-adpt:**

| Type | Path | Value |
|------|------|-------|
| SSM Parameter | `/nestfolio/{prefix}-broker-alpaca-adpt/alpaca/baseUrl` | `https://paper-api.alpaca.markets` (real) |
| Secrets Manager | `{prefix}-broker-alpaca-adpt/alpaca-api-keys` | `{ "apiKeyId": "...", "apiKeySecret": "..." }` |

**CDK changes to `service.stack.ts`:**

```typescript
import { ParamsAndSecretsLayerVersion, ParamsAndSecretsVersions } from 'aws-cdk-lib/aws-lambda';

const paramsAndSecrets = ParamsAndSecretsLayerVersion.fromVersion(
  ParamsAndSecretsVersions.V1_0_103,
  { parameterStoreTtl: Duration.seconds(5) }  // low TTL in dev for test switching
);
```

The extension runs an HTTP server on `localhost:2773` inside the Lambda. CDK passes SSM param name and secret ID as env vars (pointers, not values):

```typescript
environment: {
  TABLE_NAME: table.tableName,
  ALPACA_BASE_URL_PARAM: `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
  ALPACA_SECRET_ID: `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
}
```

**AlpacaClient refactoring** — lazy-init from extension endpoint:

```typescript
export class AlpacaClient {
  private baseUrl?: string;
  private apiKeyId?: string;
  private apiKeySecret?: string;

  private async resolve() {
    if (this.baseUrl) return;
    const port = process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT ?? '2773';
    const token = process.env.AWS_SESSION_TOKEN!;
    const headers = { 'X-Aws-Parameters-Secrets-Token': token };

    // SSM param
    const paramName = process.env.ALPACA_BASE_URL_PARAM!;
    const paramRes = await fetch(
      `http://localhost:${port}/systemsmanager/parameters/get?name=${encodeURIComponent(paramName)}`,
      { headers },
    );
    const paramData = await paramRes.json();
    this.baseUrl = paramData.Parameter.Value;

    // Secrets Manager
    const secretId = process.env.ALPACA_SECRET_ID!;
    const secretRes = await fetch(
      `http://localhost:${port}/secretsmanager/get?secretId=${encodeURIComponent(secretId)}`,
      { headers },
    );
    const secretData = await secretRes.json();
    const keys = JSON.parse(secretData.SecretString);
    this.apiKeyId = keys.apiKeyId;
    this.apiKeySecret = keys.apiKeySecret;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<AlpacaResponse<T>> {
    await this.resolve();  // lazy-init on first call, cached thereafter
    const url = `${this.baseUrl}${path}`;
    // ... rest unchanged
  }
}
```

The constructor signature is unchanged — unit tests still pass config overrides directly, bypassing `resolve()`. **No unit test changes needed.**

**Why this approach:**
- SSM always points to the real Alpaca API — dev behaves like prod
- Integration tests switch the SSM value to the mock URL in setup, restore in teardown
- Secrets leave env vars — they belong in Secrets Manager
- The 5s TTL in dev means tests wait ~6s after SSM override for the Lambda to pick up the mock URL

---

### Ephemeral Mock API (MockApiFixture)

Instead of a pre-deployed CDK stack, the mock Alpaca API is created and destroyed entirely within the test lifecycle — zero permanent infrastructure. This follows the same philosophy as EventBusTrap.

**Resources created per test run:**

| Resource | Name | Lifecycle |
|----------|------|-----------|
| IAM Role | `integ-mock-alpaca-{timestamp}` | Created in `beforeAll`, deleted in `afterAll` |
| Lambda Function | `integ-mock-alpaca-{timestamp}` | Created in `beforeAll`, deleted in `afterAll` |
| Function URL | (attached to Lambda) | Created in `beforeAll`, deleted in `afterAll` |

**Setup sequence (~15-20s):**

| Step | Action | Time |
|------|--------|------|
| 1 | `CreateRole` + `AttachRolePolicy` (AWSLambdaBasicExecutionRole only) | 1s |
| 2 | `CreateFunction` with zip from pre-built asset — retries on `InvalidParameterValueException` (IAM propagation, 2s backoff, max 5 attempts) | 5-12s |
| 3 | Wait for function `State: Active` (poll `GetFunctionConfiguration`) | 2-5s |
| 4 | `CreateFunctionUrlConfig` (AuthType: NONE) + `AddPermission` | 1-2s |

**Teardown sequence (~2-3s):**

| Step | Action |
|------|--------|
| 1 | `DeleteFunctionUrlConfig` |
| 2 | `DeleteFunction` |
| 3 | `DetachRolePolicy` |
| 4 | `DeleteRole` |

**MockApiFixture API:**

```typescript
class MockApiFixture {
  constructor(ctx: IntegrationContext);

  /**
   * Deploy ephemeral mock Lambda with Function URL.
   * Handles IAM role creation, propagation retries, and Function URL setup.
   * Returns the public Function URL.
   */
  deploy(params: {
    name: string;          // e.g., "mock-alpaca"
    handlerAsset: Buffer;  // pre-built zip from libs/integration-testing/assets/
  }): Promise<string>;

  /** Delete Function URL, Lambda, IAM Role. Registered in cleanup automatically. */
  teardown(): Promise<void>;
}
```

**Handler asset packaging:** The mock handler source lives in `libs/integration-testing/src/mock-handlers/mock-alpaca.ts` and is pre-bundled into a zip by an Nx build target using esbuild:

```
libs/integration-testing/
  src/
    mock-handlers/
      mock-alpaca.ts         ← source
  assets/
    mock-alpaca.zip          ← output of: pnpm nx build:mocks integration-testing
```

**IAM permissions required by test runner** (all available via AdminRole):

| Action | Resource |
|--------|----------|
| `iam:CreateRole`, `iam:DeleteRole`, `iam:AttachRolePolicy`, `iam:DetachRolePolicy` | `integ-mock-*` roles |
| `lambda:CreateFunction`, `lambda:DeleteFunction`, `lambda:GetFunctionConfiguration` | `integ-mock-*` functions |
| `lambda:CreateFunctionUrlConfig`, `lambda:DeleteFunctionUrlConfig` | `integ-mock-*` functions |
| `lambda:AddPermission`, `lambda:RemovePermission` | `integ-mock-*` functions |

**Stale resource cleanup:** Same pattern as EventBusTrap — resources prefixed with `integ-mock-` can be identified and swept by a future cleanup script for orphans older than 1 hour.

---

### Mock Alpaca Handler (Scenario Routing)

The mock handler is a single Lambda function (~120 lines) that receives Function URL HTTP events and returns canned Alpaca API responses. Routing is based on `event.rawPath` + `event.requestContext.http.method`.

**Routes:**

| Method | Path | Alpaca API equivalent |
|--------|------|-----------------------|
| POST | `/v2/orders` | Submit order |
| DELETE | `/v2/orders/{orderId}` | Cancel order |
| GET | `/v2/orders/{orderId}` | Get order status (poll handler) |
| POST | `/v2/ach/transfers` | Initiate transfer |
| GET | `/v2/ach/transfers/{transferId}` | Get transfer status (poll handler) |
| GET | `/v2/account` | Get account info |
| GET | `/v2/positions` | Get positions |

**Scenario routing via identifier prefixes:**

The mock inspects the order/transfer identifier to determine which canned response to return. For POST (order submission), it reads a field from the request body. For GET (polling), it uses the path parameter.

| Identifier prefix | Mock behavior |
|---|---|
| `integ-fill-*` | POST orders → 200 + `{ id: "mock-{uuid}" }`. GET → `{ status: "filled", filled_qty: "5", filled_avg_price: "150.00" }` |
| `integ-partial-*` | POST → 200. First GET → `status: "partially_filled"`. Second GET → `status: "filled"` |
| `integ-reject-*` | POST → 422 + `{ message: "insufficient buying power" }` |
| `integ-cancel-*` | POST → 200. DELETE → 204. GET → `status: "canceled"` |
| `integ-transfer-ok-*` | POST transfers → 200 + `{ id: "mock-{uuid}" }`. GET → `{ status: "COMPLETE" }` |
| `integ-transfer-fail-*` | POST → 200. GET → `{ status: "REJECTED" }` |
| default (`integ-*`) | POST → 200. GET → `status: "filled"` (safe default) |

**In-memory state:** POST handlers store created orders/transfers in a `Map<string, object>` so GET handlers return consistent data within the same Lambda execution context. This is acceptable because the mock is ephemeral and single-test-scoped.

**Account/positions routes** always return a fixed snapshot (no scenario routing needed):

```
GET /v2/account   → 200  { "equity": "125000.00", "buying_power": "50000.00" }
GET /v2/positions → 200  [{ "symbol": "AAPL", "qty": "10", "market_value": "1750.00" }]
```

---

### SsmOverrideFixture

Saves the current SSM parameter value, overwrites it with the mock URL, and restores the original in teardown. Paired with the 5s `parameterStoreTtl` on the extension, this provides the runtime-switchable mock mechanism.

```typescript
class SsmOverrideFixture {
  constructor(ctx: IntegrationContext);

  /**
   * Save current SSM value, overwrite with test value.
   * Waits for parameterStoreTtl expiry to ensure Lambda picks up new value.
   */
  override(params: {
    paramName: string;
    testValue: string;
    waitMs?: number;   // default: 6_000 (slightly > 5s TTL)
  }): Promise<void>;

  /**
   * Restore original SSM value. Registered in cleanup automatically.
   */
  restore(): Promise<void>;
}
```

---

### Test Scenarios

#### Test 1: Order Placement → Fill (happy path, full pipeline including SF)

**File:** `services/execution/broker-alpaca-adpt/test/integration/order-flow.integration.test.ts`

**What it proves:** Inbound event → event-listener Lambda → mock Alpaca POST → DDB write → CDC → `ALPACA_ORDER_PLACED` → SF triggers → poll Lambda → mock Alpaca GET → DDB update → CDC → `ALPACA_ORDER_FILLED`

```typescript
it('should place order, trigger polling SF, and fill', async () => {
  await eb.putEvent({
    bus: 'execution',
    targetService: 'broker-alpaca-adpt',
    detailType: 'ALPACA_ORDER_REQUESTED',
    detail: { orderId: `integ-fill-${Date.now()}`, symbol: 'AAPL', side: 'BUY', quantity: 5 },
  });

  // Assert: initial DDB write (PLACED)
  const item = await table.waitForItem({
    table: 'broker-alpaca-adpt',
    pk: `OrderMapping#${ctx.tenantId}#${orderId}`,
    sk: 'OrderMapping',
  });
  expect(item.status).toBe('PLACED');
  expect(item.alpacaOrderId).toBeTruthy();

  // Assert: CDC emits ALPACA_ORDER_PLACED
  const placedEvent = await trap.waitForEvent({ detailType: 'ALPACA_ORDER_PLACED' });
  expect(placedEvent.detail.subject.nestfolioOrderId).toBe(orderId);

  // Assert: SF polls mock, writes FILLED, CDC emits ALPACA_ORDER_FILLED
  const filledEvent = await trap.waitForEvent({
    detailType: 'ALPACA_ORDER_FILLED',
    timeoutMs: 60_000,  // SF initial wait (10s) + poll + write + CDC
  });
  expect(filledEvent.detail.subject.nestfolioOrderId).toBe(orderId);

  // Assert: DDB updated to FILLED
  const updated = await table.waitForItem({
    table: 'broker-alpaca-adpt',
    pk: `OrderMapping#${ctx.tenantId}#${orderId}`,
    sk: 'OrderMapping',
  });
  expect(updated.status).toBe('FILLED');
  expect(updated.filledQuantity).toBe(5);
}, 90_000);
```

#### Test 2: Order Rejection (error path, no SF)

**What it proves:** Alpaca rejection → REJECTED DDB write → CDC `ALPACA_ORDER_REJECTED`. No SF triggered (REJECTED is not a trigger for OrderPolling orchestration).

```typescript
it('should reject order and emit ALPACA_ORDER_REJECTED', async () => {
  await eb.putEvent({
    bus: 'execution',
    targetService: 'broker-alpaca-adpt',
    detailType: 'ALPACA_ORDER_REQUESTED',
    detail: { orderId: `integ-reject-${Date.now()}`, symbol: 'AAPL', side: 'BUY', quantity: 5 },
  });

  const item = await table.waitForItem({
    table: 'broker-alpaca-adpt',
    pk: `OrderMapping#${ctx.tenantId}#${orderId}`,
    sk: 'OrderMapping',
  });
  expect(item.status).toBe('REJECTED');
  expect(item.rejectionReason).toBeTruthy();

  const event = await trap.waitForEvent({ detailType: 'ALPACA_ORDER_REJECTED' });
  expect(event.detail.subject.status).toBe('REJECTED');
}, 60_000);
```

#### Test 3: Transfer Initiation → Completion (full pipeline with transfer SF)

**What it proves:** `ALPACA_TRANSFER_REQUESTED` → mock POST → DDB → CDC → `ALPACA_TRANSFER_INITIATED` → TransferPolling SF → poll → DDB update → CDC → `ALPACA_TRANSFER_COMPLETED`

```typescript
it('should initiate transfer, trigger polling SF, and complete', async () => {
  await eb.putEvent({
    bus: 'execution',
    targetService: 'broker-alpaca-adpt',
    detailType: 'ALPACA_TRANSFER_REQUESTED',
    detail: {
      transferId: `integ-transfer-ok-${Date.now()}`,
      direction: 'INCOMING', amount: 10000, relationshipId: 'rel-integ',
    },
  });

  const item = await table.waitForItem({
    table: 'broker-alpaca-adpt',
    pk: `TransferMapping#${ctx.tenantId}#${transferId}`,
    sk: 'TransferMapping',
  });
  expect(item.status).toBe('INITIATED');

  const initiatedEvent = await trap.waitForEvent({ detailType: 'ALPACA_TRANSFER_INITIATED' });
  expect(initiatedEvent.detail.subject.nestfolioTransferId).toBe(transferId);

  const completedEvent = await trap.waitForEvent({
    detailType: 'ALPACA_TRANSFER_COMPLETED',
    timeoutMs: 60_000,
  });
  expect(completedEvent.detail.subject.nestfolioTransferId).toBe(transferId);
}, 90_000);
```

#### Test 4: Account Check (stateless, no SF)

**What it proves:** `ALPACA_ACCOUNT_CHECK` → mock GET account + positions → DDB snapshot → CDC → `ALPACA_ACCOUNT_SNAPSHOT`

```typescript
it('should create account snapshot and emit ALPACA_ACCOUNT_SNAPSHOT', async () => {
  await eb.putEvent({
    bus: 'execution',
    targetService: 'broker-alpaca-adpt',
    detailType: 'ALPACA_ACCOUNT_CHECK',
    detail: {},
  });

  const item = await table.waitForItem({
    table: 'broker-alpaca-adpt',
    pk: `AccountSnapshot#${ctx.tenantId}`,
  });
  expect(item.equity).toBe('125000.00');
  expect(item.positions).toHaveLength(1);

  const event = await trap.waitForEvent({ detailType: 'ALPACA_ACCOUNT_SNAPSHOT' });
  expect(event.detail.subject.equity).toBe('125000.00');
}, 60_000);
```

### EventBusTrap Configuration

A single trap captures all outbound event types from broker-alpaca-adpt. Each test calls `trap.waitForEvent({ detailType })` to filter. The tenant-scoped EB rule pattern ensures isolation between test runs.

```typescript
await trap.deploy({
  bus: 'execution',
  detailType: [
    'ALPACA_ORDER_PLACED', 'ALPACA_ORDER_FILLED', 'ALPACA_ORDER_REJECTED',
    'ALPACA_TRANSFER_INITIATED', 'ALPACA_TRANSFER_COMPLETED',
    'ALPACA_ACCOUNT_SNAPSHOT',
  ],
});
```

### Full Test Lifecycle

```
beforeAll (~25-30s):
  1. createIntegrationContext()
  2. MockApiFixture.deploy("mock-alpaca", zipBuffer)           → mockUrl (~15-20s)
  3. SsmOverrideFixture.override(alpacaBaseUrlParam, mockUrl)  → waits 6s for TTL
  4. EventBusTrap.deploy(bus: "execution", detailType: [...])  → waits 2s for rule activation

tests run (4 scenarios, ~30-60s each for SF-inclusive tests)

afterAll:
  cleanup.runAll() → (LIFO order)
    1. EventBusTrap.teardown()        — delete EB rule + SQS queue
    2. TableAssertions.cleanup()      — delete integ- DDB items
    3. SsmOverrideFixture.restore()   — restore original Alpaca URL
    4. MockApiFixture.teardown()      — delete Function URL + Lambda + IAM role
```

---

### Updated Directory Structure

```
libs/integration-testing/
  src/
    index.ts                          ← public API barrel
    context.ts                        ← IntegrationContext factory
    fixtures/
      cognito.fixture.ts              ← Cognito test user lifecycle
      event-bus-trap.fixture.ts       ← temporary EB rule + SQS queue
      table-assertions.ts             ← DDB polling/assertions
      appsync-client.ts              ← authenticated GraphQL client
      event-bridge-client.ts         ← publish events to EB
      ssm-override.fixture.ts        ← save/override/restore SSM params (NEW)
      mock-api.fixture.ts            ← ephemeral Lambda + Function URL + IAM role (NEW)
    cleanup.ts                        ← cleanup registry
    ssm-cache.ts                     ← SSM parameter cache
    mock-handlers/
      mock-alpaca.ts                  ← scenario-routed canned responses (NEW)
  assets/
    mock-alpaca.zip                   ← pre-built by: pnpm nx build:mocks integration-testing (NEW)
  project.json
  tsconfig.json
  jest.config.js

services/execution/broker-alpaca-adpt/
  test/
    unit/                             ← existing tests moved here
      alpaca-orders.service.test.ts
      alpaca.client.test.ts
      event-listener.test.ts
      order-mapping.repository.test.ts
      order-poll-handler.test.ts
      transfer-mapping.repository.test.ts
      transfer-poll-handler.test.ts
    integration/                      ← NEW
      order-flow.integration.test.ts
      transfer-flow.integration.test.ts
      account-check.integration.test.ts
  jest.config.js                      ← updated: testMatch → test/unit/
  jest.integration.config.js          ← NEW
  project.json                        ← new target: test:integration
```

---

### Updated Starter Services

| Service | Pattern | Test Scenario |
|---------|---------|---------------|
| `investor-bff` | BFF | `initiateDeposit` mutation → Deposit record → DEPOSIT_INITIATED CDC |
| `investor-ctrl` | CTRL | ONBOARDING_COMPLETED event → Notification record → NOTIFICATION_CREATED CDC |
| `investor-adpt` | Cross-domain ADPT | ORDER_REJECTED on ExecutionBus → forwarded to InvestorBus |
| `broker-alpaca-adpt` | Third-party ADPT (NEW) | Order placement → fill (with SF), rejection, transfer → completion (with SF), account snapshot |
