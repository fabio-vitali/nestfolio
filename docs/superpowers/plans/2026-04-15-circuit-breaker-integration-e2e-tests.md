# Circuit Breaker Integration & E2E Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add integration tests for circuit breaker flows in broker-alpaca-adpt, investor-bff, and investor-ctrl, plus an E2E scenario covering the full breaker open → heal → close lifecycle.

**Architecture:** Three integration test suites (one per service) verifying CB DDB operations, CDC emission, and downstream handler behavior against deployed AWS resources. One E2E scenario verifying the cross-domain flow from broker failure through feature flag disablement and notification delivery.

**Tech Stack:** Jest (integration tests), vitest (feature-flags unit tests), @nestfolio/test-support, @nestfolio/integration-testing, deployed AWS sandbox (EventBridge, DynamoDB, SQS, AppSync)

**Spec:** `flows/broker-circuit-breaker.flow.yaml` — canonical flow reference

---

## Phase 1: broker-alpaca-adpt Integration Tests

### Task 1: Add circuit breaker integration tests to broker-alpaca-adpt

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts`

The existing integration test already has `ctx`, `eb`, `trap`, and `table` fixtures set up with a MockApiFixture. We add a new `describe` block for circuit breaker tests.

- [ ] **Step 1: Read the existing test file**

Read `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts` to understand the setup pattern. Note the `beforeAll` creates `MockApiFixture`, `SsmOverrideFixture`, `EventBusTrap`, and `TableAssertions`.

- [ ] **Step 2: Add BROKER_CIRCUIT_OPEN to the EventBusTrap**

In the existing `beforeAll`, the trap deploys for `ALPACA_ORDER_PLACED`, `ALPACA_ORDER_REJECTED`, `ALPACA_TRANSFER_INITIATED`, `ALPACA_ACCOUNT_SNAPSHOT`. Add `BROKER_CIRCUIT_OPEN` to the `detailType` array:

```typescript
await trap.deploy({
  bus: 'execution',
  detailType: [
    'ALPACA_ORDER_PLACED',
    'ALPACA_ORDER_REJECTED',
    'ALPACA_TRANSFER_INITIATED',
    'ALPACA_ACCOUNT_SNAPSHOT',
    'BROKER_CIRCUIT_OPEN',
  ],
});
```

- [ ] **Step 3: Add circuit breaker describe block**

After the existing `Account Check` describe block (or at the end), add:

```typescript
// ── Circuit Breaker ──────────────────────────────────────────────────

describe('circuit breaker', () => {
  afterEach(async () => {
    // Always clean up breaker state to avoid poisoning later tests
    const tableName = await ctx.ssm.tableName('broker-alpaca-adpt');
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));
    try {
      await ddb.send(new DeleteCommand({
        TableName: tableName,
        Key: { pk: 'CircuitBreaker#alpaca', sk: 'CircuitBreaker' },
      }));
    } catch { /* item may not exist */ }
  }, 30_000);

  it('should reject order immediately when breaker is open', async () => {
    // Arrange: manually open the breaker
    const tableName = await ctx.ssm.tableName('broker-alpaca-adpt');
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));
    await ddb.send(new PutCommand({
      TableName: tableName,
      Item: {
        pk: 'CircuitBreaker#alpaca',
        sk: 'CircuitBreaker',
        __typename: 'CircuitBreaker',
        state: 'OPEN',
        adapter: 'alpaca',
        openedAt: new Date().toISOString(),
        reason: 'Integration test',
      },
    }));

    // Act: send an order
    const orderId = `integ-cb-reject-${Date.now()}`;
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_ORDER_REQUESTED',
      detail: { orderId, symbol: 'AAPL', side: 'BUY', quantity: 1 },
    });

    // Assert: order rejected with BROKER_UNAVAILABLE
    const item = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `OrderMapping#${ctx.tenantId}#${orderId}`,
      sk: 'OrderMapping',
    });
    expect(item['status']).toBe('REJECTED');
    expect(item['rejectionReason']).toBe('BROKER_UNAVAILABLE');
  }, 60_000);

  it('should reject transfer immediately when breaker is open', async () => {
    // Arrange: manually open the breaker
    const tableName = await ctx.ssm.tableName('broker-alpaca-adpt');
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));
    await ddb.send(new PutCommand({
      TableName: tableName,
      Item: {
        pk: 'CircuitBreaker#alpaca',
        sk: 'CircuitBreaker',
        __typename: 'CircuitBreaker',
        state: 'OPEN',
        adapter: 'alpaca',
        openedAt: new Date().toISOString(),
        reason: 'Integration test',
      },
    }));

    // Act: send a transfer
    const transferId = `integ-cb-transfer-${Date.now()}`;
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_TRANSFER_REQUESTED',
      detail: { transferId, direction: 'INCOMING', amount: 5000, relationshipId: 'rel-integ' },
    });

    // Assert: transfer rejected with BROKER_UNAVAILABLE
    const item = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `TransferMapping#${ctx.tenantId}#${transferId}`,
      sk: 'TransferMapping',
    });
    expect(item['status']).toBe('FAILED');
    expect(item['failureReason']).toBe('BROKER_UNAVAILABLE');
  }, 60_000);

  it('should write NormalizedEvent when breaker opens and CDC emits BROKER_CIRCUIT_OPEN', async () => {
    // This test requires the mock API to be down. Update the mock to return 500s.
    // One approach: override the SSM param to a non-existent URL, then send an order.
    // When the order fails AND healthCheck fails, the handler opens the breaker
    // and writes a NormalizedEvent.
    //
    // NOTE: This test depends on how the mock is configured. If the mock always
    // returns successes, you'll need to deploy a second mock that returns 500s,
    // or use an SSM override pointing to a non-routable IP.

    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
      testValue: 'https://192.0.2.1', // RFC 5737 non-routable — guaranteed to timeout
    });

    const orderId = `integ-cb-open-${Date.now()}`;
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_ORDER_REQUESTED',
      detail: { orderId, symbol: 'AAPL', side: 'BUY', quantity: 1 },
    });

    // Assert: breaker opened
    const breakerItem = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: 'CircuitBreaker#alpaca',
      sk: 'CircuitBreaker',
    });
    expect(breakerItem['state']).toBe('OPEN');

    // Assert: CDC emitted BROKER_CIRCUIT_OPEN
    const cbEvent = await trap.waitForEvent({ detailType: 'BROKER_CIRCUIT_OPEN' });
    expect(cbEvent).toBeDefined();
  }, 120_000); // longer timeout — HTTP timeout + SQS visibility
});
```

**Implementation note:** The third test (breaker opens on failure) is the most complex. It requires the Alpaca API mock to return errors. The implementer should:
1. Check if the mock supports error mode configuration
2. If not, use the SSM override trick: point `ALPACA_BASE_URL_PARAM` to a non-routable IP (`192.0.2.1`) so the HTTP client times out
3. The Lambda's `requestWithRetry()` will exhaust retries, then `healthCheck()` will also fail, triggering `circuitBreakerRepo.open()`
4. Be aware the Lambda timeout (60s for adapter profile) plus SQS visibility timeout may require a longer test timeout (120s)

- [ ] **Step 4: Run integration tests**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run broker-alpaca-adpt:test-integration`
Expected: PASS — all existing tests + 3 new circuit breaker tests pass.

**Note:** If the third test is too fragile due to timeout dependencies, mark it as `.skip` and add a `// TODO: requires mock error mode` comment. The first two tests (open-breaker rejection) are deterministic and should always pass.

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-alpaca-adpt/test/integration/
git commit -m "test(broker-alpaca-adpt): add circuit breaker integration tests"
```

---

## Phase 2: investor-ctrl Integration Tests

### Task 2: Add circuit breaker notification integration tests to investor-ctrl

**Files:**
- Modify: `services/investor/investor-ctrl/test/integration/investor-ctrl.integration.test.ts`

- [ ] **Step 1: Read the existing test file**

Read `services/investor/investor-ctrl/test/integration/investor-ctrl.integration.test.ts` to understand the setup. It should have `ctx`, `eb`, `trap`, and `table` from test-support + integration-testing.

- [ ] **Step 2: Add NOTIFICATION_CREATED to the EventBusTrap**

Ensure the trap includes `NOTIFICATION_CREATED` in its detailType array (it may already be there for other notification tests).

- [ ] **Step 3: Add circuit breaker notification test cases**

Add a new describe block:

```typescript
describe('circuit breaker notifications', () => {
  it('should create SYSTEM notification for BROKER_CIRCUIT_OPEN', async () => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-ctrl',
      detailType: 'BROKER_CIRCUIT_OPEN',
      detail: {},
    });

    // Wait for Notification record in DDB
    const item = await table.waitForItem({
      table: 'investor-ctrl',
      pk: expect.stringContaining('Notification#SYSTEM#'),
      sk: 'Notification',
    });
    expect(item['tenantId']).toBe('SYSTEM');
    expect(item['type']).toBe('BROKER_CIRCUIT_OPEN');
    expect(item['title']).toBe('Some features are temporarily paused');
    expect(item['channel']).toBe('push');

    // Wait for CDC to emit NOTIFICATION_CREATED
    const notifEvent = await trap.waitForEvent({ detailType: 'NOTIFICATION_CREATED' });
    expect(notifEvent).toBeDefined();
  }, 60_000);

  it('should create SYSTEM notification for BROKER_CIRCUIT_CLOSED', async () => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-ctrl',
      detailType: 'BROKER_CIRCUIT_CLOSED',
      detail: {},
    });

    const item = await table.waitForItem({
      table: 'investor-ctrl',
      pk: expect.stringContaining('Notification#SYSTEM#'),
      sk: 'Notification',
    });
    expect(item['tenantId']).toBe('SYSTEM');
    expect(item['type']).toBe('BROKER_CIRCUIT_CLOSED');
    expect(item['title']).toBe('All features are available');
  }, 60_000);

  it('should create SYSTEM notification with email+push for BROKER_HEAL_ESCALATED', async () => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-ctrl',
      detailType: 'BROKER_HEAL_ESCALATED',
      detail: {},
    });

    const item = await table.waitForItem({
      table: 'investor-ctrl',
      pk: expect.stringContaining('Notification#SYSTEM#'),
      sk: 'Notification',
    });
    expect(item['tenantId']).toBe('SYSTEM');
    expect(item['type']).toBe('BROKER_HEAL_ESCALATED');
    expect(item['channel']).toBe('email,push');
  }, 60_000);
});
```

**Implementation note:** The `table.waitForItem` pk uses `expect.stringContaining` because the notification ID is based on `ctx.eventId` which is generated at publish time. The implementer should check the existing test file for the exact `TableAssertions` API — if `waitForItem` doesn't support matchers in the pk field, use `waitForItemMatching` or query the GSI instead:

```typescript
// Alternative: query typename-timestamp-index GSI for recent Notification records
const items = await table.query({
  table: 'investor-ctrl',
  indexName: 'typename-timestamp-index',
  pk: 'Notification',
  skPrefix: new Date().toISOString().slice(0, 10), // today's date prefix
});
const systemNotif = items.find(i => i['tenantId'] === 'SYSTEM' && i['type'] === 'BROKER_CIRCUIT_OPEN');
expect(systemNotif).toBeDefined();
```

- [ ] **Step 4: Run integration tests**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run investor-ctrl:test-integration`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-ctrl/test/integration/
git commit -m "test(investor-ctrl): add circuit breaker notification integration tests"
```

---

## Phase 3: investor-bff Integration Tests

### Task 3: Add circuit breaker feature flag integration tests to investor-bff

**Files:**
- Modify: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`

- [ ] **Step 1: Read the existing test file**

Read `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`.

- [ ] **Step 2: Add circuit breaker feature flag test cases**

The BROKER_CIRCUIT_OPEN/CLOSED handlers call AppSync `updateFeatureFlag` mutations via IAM-signed HTTP. In the integration test, we verify:
1. Publish BROKER_CIRCUIT_OPEN → handler fires → feature flags disabled in DDB
2. Publish BROKER_CIRCUIT_CLOSED → handler fires → feature flags re-enabled in DDB

```typescript
describe('circuit breaker feature flags', () => {
  it('should disable feature flags on BROKER_CIRCUIT_OPEN', async () => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: 'BROKER_CIRCUIT_OPEN',
      detail: {},
    });

    // Wait for FeatureFlag records to be written via AppSync mutation → DDB
    // The handler calls updateFeatureFlag 3 times (confirmDecision, initiateDeposit, requestWithdrawal)
    // Each one PutItems a FeatureFlag record at pk=FeatureFlag#SYSTEM, sk=FeatureFlag#{name}
    const tableName = await ctx.ssm.tableName('investor-bff');
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));

    const deadline = Date.now() + 60_000;
    let found = false;
    while (Date.now() < deadline) {
      const result = await ddb.send(new GetCommand({
        TableName: tableName,
        Key: { pk: 'FeatureFlag#SYSTEM', sk: 'FeatureFlag#initiateDeposit' },
      }));
      if (result.Item && result.Item['enabled'] === false) {
        found = true;
        break;
      }
      await new Promise(r => setTimeout(r, 2_000));
    }
    expect(found).toBe(true);

    // Verify all 3 flags disabled
    for (const flagName of ['confirmDecision', 'initiateDeposit', 'requestWithdrawal']) {
      const result = await ddb.send(new GetCommand({
        TableName: tableName,
        Key: { pk: 'FeatureFlag#SYSTEM', sk: `FeatureFlag#${flagName}` },
      }));
      expect(result.Item).toBeDefined();
      expect(result.Item!['enabled']).toBe(false);
      expect(result.Item!['reason']).toBe('Broker connectivity issue');
    }
  }, 90_000);

  it('should re-enable feature flags on BROKER_CIRCUIT_CLOSED', async () => {
    // First disable (from previous test or explicit setup)
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: 'BROKER_CIRCUIT_OPEN',
      detail: {},
    });

    // Wait for flags to be disabled
    const tableName = await ctx.ssm.tableName('investor-bff');
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, GetCommand } = await import('@aws-sdk/lib-dynamodb');
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));

    const deadline1 = Date.now() + 60_000;
    while (Date.now() < deadline1) {
      const r = await ddb.send(new GetCommand({
        TableName: tableName,
        Key: { pk: 'FeatureFlag#SYSTEM', sk: 'FeatureFlag#initiateDeposit' },
      }));
      if (r.Item && r.Item['enabled'] === false) break;
      await new Promise(r => setTimeout(r, 2_000));
    }

    // Now close the breaker
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: 'BROKER_CIRCUIT_CLOSED',
      detail: {},
    });

    // Wait for flags to be re-enabled
    const deadline2 = Date.now() + 60_000;
    let found = false;
    while (Date.now() < deadline2) {
      const r = await ddb.send(new GetCommand({
        TableName: tableName,
        Key: { pk: 'FeatureFlag#SYSTEM', sk: 'FeatureFlag#initiateDeposit' },
      }));
      if (r.Item && r.Item['enabled'] === true) {
        found = true;
        break;
      }
      await new Promise(r => setTimeout(r, 2_000));
    }
    expect(found).toBe(true);

    // Verify all 3 re-enabled
    for (const flagName of ['confirmDecision', 'initiateDeposit', 'requestWithdrawal']) {
      const result = await ddb.send(new GetCommand({
        TableName: tableName,
        Key: { pk: 'FeatureFlag#SYSTEM', sk: `FeatureFlag#${flagName}` },
      }));
      expect(result.Item!['enabled']).toBe(true);
    }
  }, 120_000);
});
```

**Implementation note:** These tests depend on the AppSync API being deployed with IAM auth enabled and the `APPSYNC_URL` env var being set on the Ingress Lambda. If the investor-bff stack hasn't been deployed with the CB changes yet, these tests will fail with `APPSYNC_URL not set` warnings. Ensure the stack is deployed first: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff`

- [ ] **Step 3: Run integration tests**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run investor-bff:test-integration`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/investor/investor-bff/test/integration/
git commit -m "test(investor-bff): add circuit breaker feature flag integration tests"
```

---

## Phase 4: E2E Scenario — Circuit Breaker Lifecycle

### Task 4: Create withBreakerOpen fixture

**Files:**
- Modify: `apps/e2e-feature-tests/src/helpers/fixtures.ts`

- [ ] **Step 1: Add withBreakerOpen fixture**

In `apps/e2e-feature-tests/src/helpers/fixtures.ts`, add a new fixture that opens the circuit breaker by directly writing to the broker-alpaca-adpt DDB table. This simulates the broker-alpaca-adpt handler detecting a failure and opening the breaker.

```typescript
import { AlpacaAdptEventTypes } from '@nestfolio/broker-alpaca-adpt/events';
```

Add at the end of the file:

```typescript
/**
 * Opens the circuit breaker on broker-alpaca-adpt by writing a CircuitBreaker
 * DDB record and a NormalizedEvent (which triggers CDC → BROKER_CIRCUIT_OPEN).
 * Simulates what the handler does when Alpaca API is unreachable.
 */
export function withBreakerOpen(): Fixture {
  return async (ctx, _tenant, _eb, _bff) => {
    const tableName = await ctx.ssm.tableName('broker-alpaca-adpt');
    const ddbClient = new DynamoDBClient({ region: ctx.region });
    const ddb = DynamoDBDocumentClient.from(ddbClient);
    const now = new Date().toISOString();

    try {
      // Open the breaker
      await ddb.send(new PutCommand({
        TableName: tableName,
        Item: {
          pk: 'CircuitBreaker#alpaca',
          sk: 'CircuitBreaker',
          __typename: 'CircuitBreaker',
          state: 'OPEN',
          adapter: 'alpaca',
          openedAt: now,
          reason: 'E2E test — simulated failure',
        },
      }));

      // Write NormalizedEvent to trigger CDC → BROKER_CIRCUIT_OPEN
      await ddb.send(new PutCommand({
        TableName: tableName,
        Item: {
          pk: `NormalizedEvent#${_tenant.tenantId}#CIRCUIT_BREAKER`,
          sk: `BROKER_CIRCUIT_OPEN#${now}`,
          __typename: 'NormalizedEvent',
          tenantId: _tenant.tenantId,
          timestamp: now,
        },
      }));
    } finally {
      ddbClient.destroy();
    }

    return {};
  };
}

/**
 * Closes the circuit breaker by updating the DDB record and writing a
 * NormalizedEvent (which triggers CDC → BROKER_CIRCUIT_CLOSED).
 */
export function closeBreakerFixture(): Fixture {
  return async (ctx, _tenant, _eb, _bff) => {
    const tableName = await ctx.ssm.tableName('broker-alpaca-adpt');
    const ddbClient = new DynamoDBClient({ region: ctx.region });
    const ddb = DynamoDBDocumentClient.from(ddbClient);
    const now = new Date().toISOString();

    try {
      // Close the breaker
      const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
      await ddb.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk: 'CircuitBreaker#alpaca', sk: 'CircuitBreaker' },
        UpdateExpression: 'SET #st = :st, closedAt = :ca',
        ExpressionAttributeNames: { '#st': 'state' },
        ExpressionAttributeValues: { ':st': 'CLOSED', ':ca': now },
      }));

      // Write NormalizedEvent to trigger CDC → BROKER_CIRCUIT_CLOSED
      await ddb.send(new PutCommand({
        TableName: tableName,
        Item: {
          pk: `NormalizedEvent#${_tenant.tenantId}#CIRCUIT_BREAKER`,
          sk: `BROKER_CIRCUIT_CLOSED#${now}`,
          __typename: 'NormalizedEvent',
          tenantId: _tenant.tenantId,
          timestamp: now,
        },
      }));
    } finally {
      ddbClient.destroy();
    }

    return {};
  };
}
```

Also add to the imports at the top:

```typescript
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
```

- [ ] **Step 2: Export from index**

In `apps/e2e-feature-tests/src/index.ts`, add:

```typescript
export { withBreakerOpen, closeBreakerFixture } from './helpers/fixtures';
```

- [ ] **Step 3: Commit**

```bash
git add apps/e2e-feature-tests/src/
git commit -m "test(e2e): add withBreakerOpen and closeBreakerFixture fixtures"
```

### Task 5: Add getFeatureFlags to GraphQL types

**Files:**
- Modify: `apps/e2e-feature-tests/src/helpers/graphql-types.ts`

- [ ] **Step 1: Read the file**

Read `apps/e2e-feature-tests/src/helpers/graphql-types.ts` to see existing type definitions.

- [ ] **Step 2: Add FeatureFlag types**

```typescript
export interface FeatureFlag {
  name: string;
  enabled: boolean;
  reason: string | null;
}

export interface FeatureFlagsResponse {
  getFeatureFlags: FeatureFlag[];
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/graphql-types.ts
git commit -m "test(e2e): add FeatureFlag GraphQL types"
```

### Task 6: Write circuit breaker E2E scenario

**Files:**
- Create: `apps/e2e-feature-tests/src/account/circuit-breaker-lifecycle.e2e.test.ts`

This scenario tests the full lifecycle: breaker open → features paused → breaker closed → features restored.

- [ ] **Step 1: Write the scenario**

```typescript
import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  withBreakerOpen,
  closeBreakerFixture,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';
import type { FeatureFlagsResponse } from '../helpers/graphql-types';

describe('scenario 14 — circuit breaker lifecycle', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded(), funded({ cashBalanceCents: 500_000 })]);
  }, 180_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('disables gated mutations when breaker opens and re-enables when breaker closes', async () => {
    const bff = bffClient(ctx, tenant);

    // ── Phase 1: Verify baseline — features work ─────────────────────
    // initiateDeposit should succeed before the breaker is open
    const deposit = await bff.investor.mutate<{
      initiateDeposit: { depositId: string; status: string };
    }>(
      `mutation InitiateDeposit($input: DepositInput!) {
         initiateDeposit(input: $input) { depositId status }
       }`,
      { input: { amountCents: 100_000, currency: 'USD' } },
    );
    expect(deposit.initiateDeposit.status).toBe('INITIATED');

    // ── Phase 2: Open the breaker ────────────────────────────────────
    await applyFixtures(ctx, tenant, [withBreakerOpen()]);

    // Wait for feature flags to be disabled (CDC → investor-adpt → investor-bff)
    const disabledFlags = await waitForGraphQL<FeatureFlagsResponse>(
      bff.investor,
      `query { getFeatureFlags { name enabled reason } }`,
      {},
      (r) => r.getFeatureFlags.some(f => f.name === 'initiateDeposit' && !f.enabled),
      { timeoutMs: 120_000 },
    );
    expect(disabledFlags.getFeatureFlags.find(f => f.name === 'initiateDeposit')?.enabled).toBe(false);
    expect(disabledFlags.getFeatureFlags.find(f => f.name === 'requestWithdrawal')?.enabled).toBe(false);

    // Verify gated mutation is blocked
    try {
      await bff.investor.mutate<unknown>(
        `mutation InitiateDeposit($input: DepositInput!) {
           initiateDeposit(input: $input) { depositId status }
         }`,
        { input: { amountCents: 50_000, currency: 'USD' } },
      );
      fail('Expected mutation to be blocked by feature flag');
    } catch (err) {
      expect((err as Error).message).toContain('SERVICE_TEMPORARILY_UNAVAILABLE');
    }

    // ── Phase 3: Close the breaker ───────────────────────────────────
    await applyFixtures(ctx, tenant, [closeBreakerFixture()]);

    // Wait for feature flags to be re-enabled
    const enabledFlags = await waitForGraphQL<FeatureFlagsResponse>(
      bff.investor,
      `query { getFeatureFlags { name enabled reason } }`,
      {},
      (r) => {
        const flag = r.getFeatureFlags.find(f => f.name === 'initiateDeposit');
        return flag?.enabled === true;
      },
      { timeoutMs: 120_000 },
    );
    expect(enabledFlags.getFeatureFlags.find(f => f.name === 'initiateDeposit')?.enabled).toBe(true);

    // Verify gated mutation works again
    const deposit2 = await bff.investor.mutate<{
      initiateDeposit: { depositId: string; status: string };
    }>(
      `mutation InitiateDeposit($input: DepositInput!) {
         initiateDeposit(input: $input) { depositId status }
       }`,
      { input: { amountCents: 30_000, currency: 'USD' } },
    );
    expect(deposit2.initiateDeposit.status).toBe('INITIATED');
  }, 360_000); // full lifecycle — 6 min timeout

  it('creates system notifications for breaker open and close', async () => {
    const bff = bffClient(ctx, tenant);

    // Open breaker
    await applyFixtures(ctx, tenant, [withBreakerOpen()]);

    // Wait for SYSTEM notification to appear via notifications query
    // Note: SYSTEM notifications may need a separate query path.
    // If getNotifications only returns tenant-specific notifications,
    // this test verifies via DDB directly.
    const tableName = await ctx.ssm.tableName('investor-ctrl');
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, QueryCommand } = await import('@aws-sdk/lib-dynamodb');
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));

    const deadline = Date.now() + 120_000;
    let found = false;
    while (Date.now() < deadline) {
      const result = await ddb.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :tid AND __typename = :tn',
        ExpressionAttributeValues: { ':tid': 'SYSTEM', ':tn': 'Notification' },
      }));
      if (result.Items?.some(i => i['type'] === 'BROKER_CIRCUIT_OPEN')) {
        found = true;
        break;
      }
      await new Promise(r => setTimeout(r, 3_000));
    }
    expect(found).toBe(true);
  }, 180_000);
});
```

**Implementation notes:**
1. The timeout is 360s for the full lifecycle test because each phase requires CDC propagation (broker-alpaca-adpt → execution-hub → investor-adpt → investor-bff).
2. The `withBreakerOpen` fixture writes directly to DDB rather than triggering a real Alpaca failure — this is deliberate. The integration test in Task 1 covers the real failure detection; the E2E test covers the downstream propagation.
3. If `getFeatureFlags` isn't deployed yet, the `waitForGraphQL` will timeout. Ensure investor-bff is deployed with the CB changes.
4. The notification test queries DDB directly (via tenantId-index GSI) because the `getNotifications` GraphQL query filters by the authenticated tenant, not SYSTEM.

- [ ] **Step 2: Run E2E tests**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern circuit-breaker`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/e2e-feature-tests/
git commit -m "test(e2e): add scenario 14 — circuit breaker lifecycle (open/close/notifications)"
```

---

## Deferred (not in scope for this plan)

- **HealStateMachine integration test** — Testing the Step Functions HTTP:Invoke health check loop requires either a real Alpaca API (paper trading) or a mock that can transition from 500→200 during the test. This is better handled as an operational smoke test post-deployment.
- **investor-bff AppSync subscription test** — Testing real-time WebSocket subscriptions (onFeatureFlagUpdate) in an automated test environment is brittle. The E2E scenario verifies the read path (getFeatureFlags); real-time updates are verified manually.
- **Frontend (SystemBannerComponent) E2E test** — Requires Playwright/Cypress browser automation against the running MFE host. Out of scope for the event-driven E2E test suite.
