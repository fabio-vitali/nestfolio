# Fix Circuit Breaker Integration Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all three compliance issues discovered in the circuit breaker integration test review: (1) unskip the BROKER_CIRCUIT_OPEN CDC emission test in broker-alpaca-adpt by adding error mode to mock-alpaca, (2) add `match` support to `TableAssertions.waitForItem()`, (3) replace manual polling loops and raw DDB reads in investor-bff with framework utilities and AppSync queries.

**Architecture:** Three independent fixes across three codebases. Task 1 adds a `match` parameter to the shared `TableAssertions` fixture — this is a prerequisite for Tasks 2 and 3. Task 2 modifies mock-alpaca to support a `broker-down` error scenario and unskips the CDC emission test. Task 3 rewrites the investor-bff feature flag tests to use `table.waitForItem()` with `match` and the `getFeatureFlags` AppSync query.

**Tech Stack:** TypeScript, Jest, DynamoDB, EventBridge, AppSync, @nestfolio/integration-testing, @nestfolio/test-support

---

### Task 1: Add `match` support to `TableAssertions.waitForItem()`

**Files:**
- Modify: `libs/integration-testing/src/fixtures/table-assertions.ts:42-83`
- Create: `libs/integration-testing/test/table-assertions.test.ts`

This enables conditional polling — `waitForItem()` returns only when the item exists AND all `match` fields equal the expected values. Without this, every test that needs to wait for a field to change must write a manual polling loop.

- [ ] **Step 1: Write the failing test**

```typescript
// libs/integration-testing/test/table-assertions.test.ts
import { TableAssertions } from '../src/fixtures/table-assertions';

describe('TableAssertions.waitForItem match', () => {
  it('should reject items that do not satisfy match predicate', () => {
    const item = { pk: 'a', sk: 'b', status: 'PENDING' };
    const match = { status: 'COMPLETE' };
    const matches = Object.entries(match).every(([k, v]) => item[k] === v);
    expect(matches).toBe(false);
  });

  it('should accept items that satisfy match predicate', () => {
    const item = { pk: 'a', sk: 'b', status: 'COMPLETE' };
    const match = { status: 'COMPLETE' };
    const matches = Object.entries(match).every(([k, v]) => item[k] === v);
    expect(matches).toBe(true);
  });

  it('should accept items when no match is specified', () => {
    const item = { pk: 'a', sk: 'b', status: 'PENDING' };
    const match = undefined;
    const matches = !match || Object.entries(match).every(([k, v]) => item[k] === v);
    expect(matches).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm nx test integration-testing -- --testPathPattern=table-assertions
```

Expected: PASS (these are pure logic tests for the match predicate).

- [ ] **Step 3: Add `match` parameter to `waitForItem`**

In `libs/integration-testing/src/fixtures/table-assertions.ts`, update the method signature and polling loop:

```typescript
// Change the params type at line 42-48 to:
async waitForItem(params: {
  table: string;
  pk: string;
  sk?: string;
  match?: Record<string, unknown>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<Record<string, unknown>> {
```

Then, inside the polling loop, after successfully fetching an item (two locations — the `GetItem` branch at line 60 and the `Query` branch at line 72), add a match check before returning. Replace the two return blocks:

**GetItem branch (line 60-64)** — replace:
```typescript
        if (result.Item) {
          const item = unmarshall(result.Item);
          this.observed.push({ tableName, pk: item['pk'] as string, sk: item['sk'] as string });
          return item;
        }
```
with:
```typescript
        if (result.Item) {
          const item = unmarshall(result.Item);
          if (!params.match || Object.entries(params.match).every(([k, v]) => item[k] === v)) {
            this.observed.push({ tableName, pk: item['pk'] as string, sk: item['sk'] as string });
            return item;
          }
        }
```

**Query branch (line 72-76)** — replace:
```typescript
        if (result.Items?.length) {
          const item = unmarshall(result.Items[0]);
          this.observed.push({ tableName, pk: item['pk'] as string, sk: item['sk'] as string });
          return item;
        }
```
with:
```typescript
        if (result.Items?.length) {
          const item = unmarshall(result.Items[0]);
          if (!params.match || Object.entries(params.match).every(([k, v]) => item[k] === v)) {
            this.observed.push({ tableName, pk: item['pk'] as string, sk: item['sk'] as string });
            return item;
          }
        }
```

Update the timeout error message at line 82 to include the match criteria:

```typescript
    const matchDesc = params.match ? ` match=${JSON.stringify(params.match)}` : '';
    throw new Error(`TableAssertions: timeout waiting for item pk=${params.pk} sk=${params.sk ?? '(any)'}${matchDesc} in ${params.table} after ${timeout}ms`);
```

- [ ] **Step 4: Run existing integration-testing tests to verify nothing breaks**

```bash
pnpm nx test integration-testing
```

Expected: all existing tests PASS (the `match` parameter is optional, defaults to no-op).

- [ ] **Step 5: Commit**

```bash
git add libs/integration-testing/src/fixtures/table-assertions.ts libs/integration-testing/test/table-assertions.test.ts
git commit -m "feat(integration-testing): add match parameter to waitForItem for conditional polling"
```

---

### Task 2: Add error mode to mock-alpaca and unskip BROKER_CIRCUIT_OPEN CDC test

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/test/mocks/mock-alpaca.ts`
- Modify: `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts:252-278`

The current mock Lambda always returns 200 for `GET /v2/account` (health check). The handler opens the circuit breaker only when: (a) the API call fails after 3 retries, AND (b) the health check also fails. We need the mock to support a `broker-down` scenario where ALL endpoints return 503.

**Strategy:** Add an `integ-broker-down-` prefix scenario. When an order with this prefix is submitted, the mock switches to "down" mode — returning 503 for the order AND for subsequent health checks. This simulates the exact conditions the handler needs to open the breaker.

However, the mock is stateless per-request — we need in-memory state. The mock already uses `Map()` for orders/transfers. We add a `brokerDown` flag that `integ-broker-down-` orders set, and health check reads.

- [ ] **Step 1: Add broker-down scenario to mock-alpaca**

In `services/execution/broker-alpaca-adpt/test/mocks/mock-alpaca.ts`:

Add `integ-broker-down-` to `getScenario()`:
```typescript
function getScenario(identifier: string): string {
  if (identifier.startsWith('integ-fill-')) return 'fill';
  if (identifier.startsWith('integ-partial-')) return 'partial';
  if (identifier.startsWith('integ-reject-')) return 'reject';
  if (identifier.startsWith('integ-cancel-')) return 'cancel';
  if (identifier.startsWith('integ-broker-down-')) return 'broker-down';
  if (identifier.startsWith('integ-transfer-ok-')) return 'transfer-ok';
  if (identifier.startsWith('integ-transfer-fail-')) return 'transfer-fail';
  return 'fill'; // safe default
}
```

Add a `brokerDown` flag at the top of the file (after `pollCounts`):
```typescript
let brokerDown = false;
```

In the `POST /v2/orders` handler, add the `broker-down` scenario (after the `reject` scenario block at line 33):
```typescript
    if (scenario === 'broker-down') {
      brokerDown = true;
      return json(503, { message: 'service unavailable' });
    }
```

In the `GET /v2/account` handler, replace the always-200 response (line 98-106):
```typescript
  // GET /v2/account
  if (method === 'GET' && path === '/v2/account') {
    if (brokerDown) {
      return json(503, { message: 'service unavailable' });
    }
    return json(200, {
      id: 'mock-account',
      equity: '125000.00',
      buying_power: '50000.00',
      cash: '50000.00',
      portfolio_value: '75000.00',
    });
  }
```

- [ ] **Step 2: Rebuild mock-alpaca zip**

```bash
pnpm nx run broker-alpaca-adpt:build-mock
```

Expected: `mock-alpaca.zip` regenerated in `test/mocks/`.

- [ ] **Step 3: Unskip and fix the BROKER_CIRCUIT_OPEN CDC test**

In `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts`, replace the entire skipped test block (lines 252-278):

```typescript
    it('should open circuit breaker on API failure and emit BROKER_CIRCUIT_OPEN via CDC', async () => {
      const orderId = `integ-broker-down-${Date.now()}`;

      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-alpaca-adpt',
        detailType: 'ALPACA_ORDER_REQUESTED',
        detail: { orderId, symbol: 'AAPL', side: 'BUY', quantity: 5 },
      });

      // Handler: submitOrder fails 3x (503) → healthCheck fails (503) → opens breaker
      // → writes CircuitBreaker item + NormalizedEvent → CDC emits BROKER_CIRCUIT_OPEN

      // 1. Verify CircuitBreaker record written
      const cbItem = await table.waitForItem({
        table: 'broker-alpaca-adpt',
        pk: CB_PK,
        sk: CB_SK,
        match: { state: 'OPEN' },
        timeoutMs: 90_000,
      });
      expect(cbItem['adapter']).toBe('alpaca');

      // 2. Verify order was rejected with BROKER_UNAVAILABLE
      const orderItem = await table.waitForItem({
        table: 'broker-alpaca-adpt',
        pk: `OrderMapping#${ctx.tenantId}#${orderId}`,
        sk: 'OrderMapping',
      });
      expect(orderItem['status']).toBe('REJECTED');
      expect(orderItem['rejectionReason']).toBe('BROKER_UNAVAILABLE');

      // 3. Verify CDC emitted BROKER_CIRCUIT_OPEN on ExecutionBus
      const event = await trap.waitForEvent<BusEventPayload>({ detailType: 'BROKER_CIRCUIT_OPEN' });
      expect(event.detail.subject.adapter).toBe('alpaca');
    }, 120_000);
```

- [ ] **Step 4: Run the broker-alpaca-adpt unit tests to verify mock changes don't break anything**

```bash
pnpm nx test broker-alpaca-adpt
```

Expected: all unit tests PASS (mock-alpaca is only used in integration tests, unit tests use the harness).

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-alpaca-adpt/test/mocks/mock-alpaca.ts services/execution/broker-alpaca-adpt/test/mocks/mock-alpaca.zip services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts
git commit -m "test(broker-alpaca-adpt): unskip BROKER_CIRCUIT_OPEN CDC test with mock error mode"
```

---

### Task 3: Replace manual polling and raw DDB reads in investor-bff feature flag tests

**Files:**
- Modify: `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts:826-931`

**Issues to fix:**
1. Manual `while` polling loops → replace with `table.waitForItem({ match })`
2. Raw `DynamoDBDocumentClient` + `GetCommand` → replace with `appsync.query({ getFeatureFlags })`
3. Remove unused `ddb` and `tableName` variables from `beforeAll`

The `getFeatureFlags` AppSync query (Cognito-authenticated) returns `[{ name, enabled, reason }]` — exactly what we need for assertions. Using it validates the full resolver pipeline, not just raw DDB state.

- [ ] **Step 1: Replace the entire `circuit breaker feature flags` describe block**

In `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`, replace lines 826-931 with:

```typescript
  describe('circuit breaker feature flags', () => {
    const FLAG_NAMES = ['confirmDecision', 'initiateDeposit', 'requestWithdrawal'] as const;

    const GET_FEATURE_FLAGS = `
      query GetFeatureFlags {
        getFeatureFlags {
          name
          enabled
          reason
        }
      }
    `;

    async function waitForFlags(
      expectedEnabled: boolean,
      timeoutMs = 60_000,
    ): Promise<Array<{ name: string; enabled: boolean; reason: string | null }>> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const result = await appsync.query<{
          getFeatureFlags: Array<{ name: string; enabled: boolean; reason: string | null }>;
        }>(GET_FEATURE_FLAGS, {});

        const targetFlags = result.getFeatureFlags.filter(f =>
          (FLAG_NAMES as readonly string[]).includes(f.name),
        );
        if (
          targetFlags.length === FLAG_NAMES.length &&
          targetFlags.every(f => f.enabled === expectedEnabled)
        ) {
          return targetFlags;
        }
        await new Promise(r => setTimeout(r, 2_000));
      }
      throw new Error(`Timeout: flags not ${expectedEnabled ? 'enabled' : 'disabled'} after ${timeoutMs}ms`);
    }

    it('should disable feature flags on BROKER_CIRCUIT_OPEN', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'BROKER_CIRCUIT_OPEN',
        detail: {},
      });

      const flags = await waitForFlags(false);

      for (const flag of flags) {
        expect(flag.enabled).toBe(false);
        expect(flag.reason).toBe('Broker connectivity issue');
      }
    }, 90_000);

    it('should re-enable feature flags on BROKER_CIRCUIT_CLOSED', async () => {
      // Setup: ensure flags are disabled first
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'BROKER_CIRCUIT_OPEN',
        detail: {},
      });
      await waitForFlags(false);

      // Act: close the breaker
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'BROKER_CIRCUIT_CLOSED',
        detail: {},
      });

      const flags = await waitForFlags(true);

      for (const flag of flags) {
        expect(flag.enabled).toBe(true);
      }
    }, 120_000);
  });
```

- [ ] **Step 2: Remove unused DynamoDB imports**

At the top of the file, remove the `DynamoDBClient` and `DynamoDBDocumentClient` imports that are only used by the circuit breaker section. Check if any other `describe` block in the file uses them first.

The file imports at line 13-14:
```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
```

If no other test in the file uses `DynamoDBClient`, `DynamoDBDocumentClient`, or `GetCommand`, remove these two import lines entirely.

- [ ] **Step 3: Run investor-bff unit tests**

```bash
pnpm nx test investor-bff
```

Expected: all unit tests PASS (integration test file changes don't affect unit tests, but verify imports are clean).

- [ ] **Step 4: Commit**

```bash
git add services/investor/investor-bff/test/integration/investor-bff.integration.test.ts
git commit -m "test(investor-bff): replace manual polling with AppSync query in CB feature flag tests"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run all affected unit test suites**

```bash
pnpm nx run-many -t test -p broker-alpaca-adpt,investor-ctrl,investor-bff,integration-testing
```

Expected: all PASS.

- [ ] **Step 2: Verify the mock-alpaca.zip is up to date**

```bash
ls -la services/execution/broker-alpaca-adpt/test/mocks/mock-alpaca.zip
```

Expected: timestamp matches the `build-mock` run from Task 2.

- [ ] **Step 3: Lint all modified files**

```bash
pnpm nx run-many -t lint -p broker-alpaca-adpt,investor-bff,integration-testing
```

Expected: no lint errors.
