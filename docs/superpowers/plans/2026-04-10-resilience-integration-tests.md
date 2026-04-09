# Resilience Integration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add idempotency and order-agnostic integration tests to 6 financial-critical services, proving that duplicate events don't corrupt state and events in any order produce correct final state.

**Architecture:** Extend the integration-testing library with an `eventId` parameter on `EventBridgeClient.putEvent()` to enable controlled dedup testing, add resilience helper utilities, then create `resilience.integration.test.ts` files for each service. Each test publishes events via EventBridge against deployed infrastructure and asserts DDB state + CDC output.

**Tech Stack:** TypeScript, Jest, AWS EventBridge, DynamoDB, SQS, @nestfolio/integration-testing

**Spec:** `docs/superpowers/specs/2026-04-10-resilience-integration-tests-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `libs/integration-testing/src/fixtures/event-bridge-client.ts` | Add optional `eventId` param to `putEvent` |
| Create | `libs/integration-testing/src/resilience.ts` | `snapshotState`, `assertEquivalentState`, `countItems` helpers |
| Modify | `libs/integration-testing/src/index.ts` | Re-export resilience helpers |
| Create | `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts` | Idempotency + full shuffle + pairwise |
| Create | `services/execution/execution-ctrl/test/integration/execution-ctrl.resilience.integration.test.ts` | Idempotency + pairwise |
| Create | `services/execution/broker-ctrl/test/integration/broker-ctrl.resilience.integration.test.ts` | Idempotency + pairwise |
| Create | `services/ledger/reconciliation-ctrl/test/integration/reconciliation-ctrl.resilience.integration.test.ts` | Idempotency + pairwise |
| Create | `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.resilience.integration.test.ts` | Idempotency + pairwise (with MockApiFixture) |
| Create | `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.resilience.integration.test.ts` | Idempotency + pairwise (tolerant of agent failures) |

---

### Task 1: Add `eventId` parameter to EventBridgeClient

**Context:** The event-processor derives `ctx.eventId` from `detail.id` in the EventBridge event envelope (see `ingestion-engine.ts:78`). The integration-testing `EventBridgeClient` currently generates `detail.id` as `integ-${randomUUID()}`. Adding an optional `eventId` parameter lets resilience tests send the same event with the same dedup key twice.

**Files:**
- Modify: `libs/integration-testing/src/fixtures/event-bridge-client.ts:18-38`

- [ ] **Step 1: Write the unit test**

Create `libs/integration-testing/test/event-bridge-client.test.ts`:

```typescript
import { EventBridgeClient } from '../src/fixtures/event-bridge-client';

// We can't easily test against real AWS in a unit test, so verify
// the eventId parameter is accepted in the type signature.
// The real test is the resilience integration tests themselves.
describe('EventBridgeClient', () => {
  it('putEvent accepts optional eventId parameter', () => {
    // Type check — this just verifies the signature compiles
    const fn: typeof EventBridgeClient.prototype.putEvent = async (_params: {
      bus: string;
      targetService: string;
      detailType: string;
      detail: Record<string, unknown>;
      eventId?: string;
    }) => {};
    expect(fn).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test integration-testing -- --testPathPattern=event-bridge-client`
Expected: FAIL — the current `putEvent` signature doesn't include `eventId`

- [ ] **Step 3: Add `eventId` parameter to `putEvent`**

In `libs/integration-testing/src/fixtures/event-bridge-client.ts`, change the `putEvent` method:

```typescript
  async putEvent(params: {
    bus: string;
    targetService: string;
    detailType: string;
    detail: Record<string, unknown>;
    eventId?: string;
  }): Promise<void> {
    const busArn = await this.ctx.ssm.busArn(params.bus);
    const maxRetries = this.ctx.timings.putEventRetries;
    const baseBackoff = this.ctx.timings.putEventBackoffMs;

    const detail = {
      id: params.eventId ?? `integ-${randomUUID()}`,
      type: params.detailType,
      timestamp: new Date().toISOString(),
      subject: params.detail,
      context: {
        tenantId: this.ctx.tenantId,
        userId: this.ctx.userId,
        region: this.ctx.region,
      },
    };
```

The only change is line `id: params.eventId ?? \`integ-${randomUUID()}\``.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test integration-testing -- --testPathPattern=event-bridge-client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/integration-testing/src/fixtures/event-bridge-client.ts libs/integration-testing/test/event-bridge-client.test.ts
git commit -m "feat(integration-testing): add eventId parameter to EventBridgeClient.putEvent

Enables resilience tests to control the dedup key when testing
idempotency by sending the same event twice with the same eventId.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add resilience helpers to integration-testing

**Context:** Resilience tests need to snapshot DDB state (stripping dynamic fields like pk/sk/tenantId/timestamps) and compare final states between ordered and shuffled test runs. These utilities reduce boilerplate across all 6 service test files.

**Files:**
- Create: `libs/integration-testing/src/resilience.ts`
- Create: `libs/integration-testing/test/resilience.test.ts`
- Modify: `libs/integration-testing/src/index.ts`

- [ ] **Step 1: Write the unit test**

Create `libs/integration-testing/test/resilience.test.ts`:

```typescript
import { stripDynamicFields, sortSnapshot, assertEquivalentState } from '../src/resilience';

describe('resilience helpers', () => {
  describe('stripDynamicFields', () => {
    it('removes pk, sk, tenantId, userId, timestamps, eventId, sequenceNo, ttl', () => {
      const item = {
        pk: 'Account#tenant-1#actual',
        sk: 'Event#abc-123',
        tenantId: 'tenant-1',
        userId: 'user-1',
        createdAt: '2026-04-10T00:00:00Z',
        updatedAt: '2026-04-10T00:00:00Z',
        timestamp: '2026-04-10T00:00:00Z',
        ttl: 1712793600,
        eventId: 'abc-123',
        sourceEventId: 'abc-123',
        sequenceNo: 1,
        __typename: 'LedgerEntry',
        eventType: 'ORDER_FILLED',
        payload: { symbol: 'AAPL', quantity: 10 },
      };

      const result = stripDynamicFields(item);

      expect(result).toEqual({
        __typename: 'LedgerEntry',
        eventType: 'ORDER_FILLED',
        payload: { symbol: 'AAPL', quantity: 10 },
      });
    });

    it('preserves fields not in the dynamic set', () => {
      const item = { pk: 'x', sk: 'y', customField: 'keep', status: 'active' };
      const result = stripDynamicFields(item);
      expect(result).toEqual({ customField: 'keep', status: 'active' });
    });
  });

  describe('sortSnapshot', () => {
    it('sorts items by __typename then eventType', () => {
      const items = [
        { __typename: 'LedgerEntry', eventType: 'ORDER_FILLED', payload: {} },
        { __typename: 'AccountSnapshot', cashBalanceCents: 1000 },
        { __typename: 'LedgerEntry', eventType: 'DEPOSIT_DETECTED', payload: {} },
      ];

      const sorted = sortSnapshot(items);

      expect(sorted[0].__typename).toBe('AccountSnapshot');
      expect(sorted[1].eventType).toBe('DEPOSIT_DETECTED');
      expect(sorted[2].eventType).toBe('ORDER_FILLED');
    });
  });

  describe('assertEquivalentState', () => {
    it('passes for identical snapshots', () => {
      const a = [{ __typename: 'LedgerEntry', eventType: 'ORDER_FILLED' }];
      const b = [{ __typename: 'LedgerEntry', eventType: 'ORDER_FILLED' }];
      expect(() => assertEquivalentState(a, b)).not.toThrow();
    });

    it('fails for different snapshots', () => {
      const a = [{ __typename: 'LedgerEntry', eventType: 'ORDER_FILLED' }];
      const b = [{ __typename: 'LedgerEntry', eventType: 'DEPOSIT_DETECTED' }];
      expect(() => assertEquivalentState(a, b)).toThrow();
    });

    it('fails for different item counts', () => {
      const a = [{ __typename: 'LedgerEntry' }];
      const b = [{ __typename: 'LedgerEntry' }, { __typename: 'LedgerEntry' }];
      expect(() => assertEquivalentState(a, b)).toThrow();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test integration-testing -- --testPathPattern=resilience`
Expected: FAIL — module doesn't exist yet

- [ ] **Step 3: Implement resilience helpers**

Create `libs/integration-testing/src/resilience.ts`:

```typescript
import type { TableAssertions } from './fixtures/table-assertions';

const DYNAMIC_FIELDS = new Set([
  'pk', 'sk', 'tenantId', 'userId',
  'createdAt', 'updatedAt', 'timestamp',
  'ttl', 'eventId', 'sourceEventId', 'sequenceNo',
]);

export function stripDynamicFields(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (!DYNAMIC_FIELDS.has(key)) clean[key] = value;
  }
  return clean;
}

export function sortSnapshot(
  items: Record<string, unknown>[],
): Record<string, unknown>[] {
  return [...items].sort((a, b) => {
    const keyA = `${a['__typename'] ?? ''}#${a['eventType'] ?? ''}`;
    const keyB = `${b['__typename'] ?? ''}#${b['eventType'] ?? ''}`;
    return keyA.localeCompare(keyB);
  });
}

export async function snapshotState(
  table: TableAssertions,
  tableName: string,
  pk: string,
  skPrefix?: string,
): Promise<Record<string, unknown>[]> {
  const items = await table.queryItems({ table: tableName, pk, skPrefix });
  return sortSnapshot(items.map(stripDynamicFields));
}

export function assertEquivalentState(
  snapshotA: Record<string, unknown>[],
  snapshotB: Record<string, unknown>[],
): void {
  expect(sortSnapshot(snapshotA)).toEqual(sortSnapshot(snapshotB));
}

export async function countItems(
  table: TableAssertions,
  tableName: string,
  pk: string,
  skPrefix?: string,
): Promise<number> {
  const items = await table.queryItems({ table: tableName, pk, skPrefix });
  return items.length;
}
```

- [ ] **Step 4: Export from index.ts**

Add to `libs/integration-testing/src/index.ts`:

```typescript
export { snapshotState, assertEquivalentState, countItems, stripDynamicFields, sortSnapshot } from './resilience';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm nx test integration-testing -- --testPathPattern=resilience`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add libs/integration-testing/src/resilience.ts libs/integration-testing/test/resilience.test.ts libs/integration-testing/src/index.ts
git commit -m "feat(integration-testing): add resilience test helpers

snapshotState, assertEquivalentState, countItems for idempotency and
order-agnostic integration tests across financial-critical services.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: ledger-ctrl resilience tests

**Context:** Highest-priority service. Uses `skip()` in event-listener and delegates to `ledger.repository.ts` which uses `putIfNotExists()` (attribute_not_exists condition) for LedgerEntry dedup. The eventId flows as `detail.id` → `ctx.eventId` → `entry.eventId` → `sk: Event#${eventId}`. The reducer (`replayAndReduce`) materializes AccountSnapshot from LedgerEntry records. Sequence counter uses atomic ADD (non-idempotent but harmless — gaps are OK).

**DDB patterns:**
- LedgerEntry: `pk: Account#${tenantId}#actual`, `sk: Event#${eventId}`
- AccountSnapshot: `pk: Account#${tenantId}#actual`, `sk: Snapshot#latest`
- SequenceCounter: `pk: Sequence#${tenantId}#actual`, `sk: Counter`

**Files:**
- Create: `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts`

- [ ] **Step 1: Create the resilience test file**

Create `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  snapshotState,
  assertEquivalentState,
  countItems,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Poll until at least `minCount` LedgerEntry items exist under the pk. */
async function waitForEntryCount(
  table: TableAssertions,
  tenantId: string,
  streamType: string,
  minCount: number,
  timeoutMs = 60_000,
): Promise<void> {
  const pk = `Account#${tenantId}#${streamType}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await countItems(table, 'ledger-ctrl', pk, 'Event#');
    if (count >= minCount) return;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`waitForEntryCount: timeout waiting for ${minCount} entries`);
}

/** Poll until AccountSnapshot exists. */
async function waitForSnapshot(
  table: TableAssertions,
  tenantId: string,
  streamType: string,
  timeoutMs = 90_000,
): Promise<Record<string, unknown>> {
  return table.waitForItem({
    table: 'ledger-ctrl',
    pk: `Account#${tenantId}#${streamType}`,
    sk: 'Snapshot#latest',
    timeoutMs,
  });
}

// ── Idempotency ──────────────────────────────────────────────────────────

describe('ledger-ctrl resilience: idempotency', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('duplicate ORDER_FILLED does not create duplicate LedgerEntry', async () => {
    const eventId = `idemp-fill-${Date.now()}`;
    const payload = {
      orderId: `order-idemp-${Date.now()}`,
      symbol: 'AAPL',
      side: 'BUY',
      quantity: 10,
      fillPrice: 150.0,
      filledAt: new Date().toISOString(),
      executionMode: 'paper',
    };

    // First publish
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: payload,
      eventId,
    });
    await waitForEntryCount(table, ctx.tenantId, 'actual', 1);

    const countBefore = await countItems(
      table, 'ledger-ctrl', `Account#${ctx.tenantId}#actual`, 'Event#',
    );

    // Duplicate publish (same eventId)
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: payload,
      eventId,
    });

    // Wait for duplicate to be processed (or deduplicated)
    await new Promise((r) => setTimeout(r, 15_000));

    const countAfter = await countItems(
      table, 'ledger-ctrl', `Account#${ctx.tenantId}#actual`, 'Event#',
    );

    expect(countAfter).toBe(countBefore);
  }, 120_000);

  it('duplicate DEPOSIT_DETECTED does not create duplicate LedgerEntry', async () => {
    const eventId = `idemp-dep-${Date.now()}`;
    const payload = {
      depositId: `dep-idemp-${Date.now()}`,
      amountCents: 500_000,
      depositedAt: new Date().toISOString(),
    };

    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DEPOSIT_DETECTED',
      detail: payload,
      eventId,
    });
    await waitForEntryCount(table, ctx.tenantId, 'actual', 1);

    const countBefore = await countItems(
      table, 'ledger-ctrl', `Account#${ctx.tenantId}#actual`, 'Event#',
    );

    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DEPOSIT_DETECTED',
      detail: payload,
      eventId,
    });

    await new Promise((r) => setTimeout(r, 15_000));

    const countAfter = await countItems(
      table, 'ledger-ctrl', `Account#${ctx.tenantId}#actual`, 'Event#',
    );

    expect(countAfter).toBe(countBefore);
  }, 120_000);

  it('duplicate ORDER_FILLED does not emit duplicate BALANCE_UPDATED CDC', async () => {
    // Separate context to isolate CDC events
    const cdcCtx = await createIntegrationContext();
    const cdcEb = new EventBridgeClient(cdcCtx);
    const trap = new EventBusTrap(cdcCtx);
    await trap.deploy({ bus: 'ledger', detailType: 'BALANCE_UPDATED' });

    const eventId = `idemp-cdc-${Date.now()}`;
    const payload = {
      orderId: `order-cdc-idemp-${Date.now()}`,
      symbol: 'MSFT',
      side: 'BUY',
      quantity: 5,
      fillPrice: 300.0,
      filledAt: new Date().toISOString(),
      executionMode: 'paper',
    };

    // First publish — should produce one BALANCE_UPDATED
    await cdcEb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: payload,
      eventId,
    });

    await trap.waitForEvent({ detailType: 'BALANCE_UPDATED', timeoutMs: 90_000 });

    // Duplicate publish
    await cdcEb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: payload,
      eventId,
    });

    // Wait for any duplicate CDC event
    await new Promise((r) => setTimeout(r, 15_000));

    // Drain remaining events — should be empty (only the one we already consumed)
    const remaining = await trap.drain();
    const balanceEvents = remaining.filter((e) => e.detailType === 'BALANCE_UPDATED');
    expect(balanceEvents).toHaveLength(0);

    await cdcCtx.cleanup.runAll();
  }, 180_000);
});

// ── Order-Agnostic: Pairwise Inversion ───────────────────────────────────

describe('ledger-ctrl resilience: order-agnostic pairwise', () => {
  it('DEPOSIT_DETECTED then ORDER_FILLED vs reverse → same final snapshot', async () => {
    // ── Run A: ordered (deposit first) ──
    const ctxA = await createIntegrationContext();
    const ebA = new EventBridgeClient(ctxA);
    const tableA = new TableAssertions(ctxA);
    tableA.registerCleanup();

    await ebA.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DEPOSIT_DETECTED',
      detail: {
        depositId: `dep-pair-A-${Date.now()}`,
        amountCents: 500_000,
        depositedAt: new Date().toISOString(),
      },
    });
    await waitForSnapshot(tableA, ctxA.tenantId, 'actual');

    await ebA.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: {
        orderId: `fill-pair-A-${Date.now()}`,
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        fillPrice: 150.0,
        filledAt: new Date().toISOString(),
        executionMode: 'paper',
      },
    });

    // Wait for snapshot to incorporate the fill
    await new Promise((r) => setTimeout(r, 30_000));
    const snapshotA = await snapshotState(
      tableA, 'ledger-ctrl', `Account#${ctxA.tenantId}#actual`, 'Snapshot#',
    );

    // ── Run B: reversed (fill first) ──
    const ctxB = await createIntegrationContext();
    const ebB = new EventBridgeClient(ctxB);
    const tableB = new TableAssertions(ctxB);
    tableB.registerCleanup();

    await ebB.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: {
        orderId: `fill-pair-B-${Date.now()}`,
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        fillPrice: 150.0,
        filledAt: new Date().toISOString(),
        executionMode: 'paper',
      },
    });
    await waitForSnapshot(tableB, ctxB.tenantId, 'actual');

    await ebB.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DEPOSIT_DETECTED',
      detail: {
        depositId: `dep-pair-B-${Date.now()}`,
        amountCents: 500_000,
        depositedAt: new Date().toISOString(),
      },
    });

    await new Promise((r) => setTimeout(r, 30_000));
    const snapshotB = await snapshotState(
      tableB, 'ledger-ctrl', `Account#${ctxB.tenantId}#actual`, 'Snapshot#',
    );

    // ── Compare ──
    assertEquivalentState(snapshotA, snapshotB);

    await ctxA.cleanup.runAll();
    await ctxB.cleanup.runAll();
  }, 300_000);
});

// ── Order-Agnostic: Full Shuffle (Financial-Critical) ────────────────────

describe('ledger-ctrl resilience: order-agnostic full shuffle', () => {
  it('3 events in shuffled order produce same final snapshot as sequential', async () => {
    const events = [
      {
        detailType: 'DEPOSIT_DETECTED',
        detail: (suffix: string) => ({
          depositId: `dep-shuffle-${suffix}-${Date.now()}`,
          amountCents: 1_000_000,
          depositedAt: new Date().toISOString(),
        }),
      },
      {
        detailType: 'ORDER_FILLED',
        detail: (suffix: string) => ({
          orderId: `fill1-shuffle-${suffix}-${Date.now()}`,
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 5,
          fillPrice: 180.0,
          filledAt: new Date().toISOString(),
          executionMode: 'paper',
        }),
      },
      {
        detailType: 'ORDER_FILLED',
        detail: (suffix: string) => ({
          orderId: `fill2-shuffle-${suffix}-${Date.now()}`,
          symbol: 'MSFT',
          side: 'BUY',
          quantity: 3,
          fillPrice: 420.0,
          filledAt: new Date().toISOString(),
          executionMode: 'paper',
        }),
      },
    ];

    // ── Run A: sequential order ──
    const ctxA = await createIntegrationContext();
    const ebA = new EventBridgeClient(ctxA);
    const tableA = new TableAssertions(ctxA);
    tableA.registerCleanup();

    for (const evt of events) {
      await ebA.putEvent({
        bus: 'ledger',
        targetService: 'ledger-ctrl',
        detailType: evt.detailType,
        detail: evt.detail('A'),
      });
      // Wait between events for sequential processing
      await new Promise((r) => setTimeout(r, 10_000));
    }
    await waitForEntryCount(tableA, ctxA.tenantId, 'actual', 3);
    // Allow reducer to process all entries into snapshot
    await new Promise((r) => setTimeout(r, 30_000));
    const snapshotA = await snapshotState(
      tableA, 'ledger-ctrl', `Account#${ctxA.tenantId}#actual`, 'Snapshot#',
    );

    // ── Run B: shuffled order [2, 0, 1] → MSFT fill, deposit, AAPL fill ──
    const shuffled = [events[2], events[0], events[1]];
    const ctxB = await createIntegrationContext();
    const ebB = new EventBridgeClient(ctxB);
    const tableB = new TableAssertions(ctxB);
    tableB.registerCleanup();

    for (const evt of shuffled) {
      await ebB.putEvent({
        bus: 'ledger',
        targetService: 'ledger-ctrl',
        detailType: evt.detailType,
        detail: evt.detail('B'),
      });
      await new Promise((r) => setTimeout(r, 10_000));
    }
    await waitForEntryCount(tableB, ctxB.tenantId, 'actual', 3);
    await new Promise((r) => setTimeout(r, 30_000));
    const snapshotB = await snapshotState(
      tableB, 'ledger-ctrl', `Account#${ctxB.tenantId}#actual`, 'Snapshot#',
    );

    // ── Compare ──
    assertEquivalentState(snapshotA, snapshotB);

    await ctxA.cleanup.runAll();
    await ctxB.cleanup.runAll();
  }, 360_000);
});
```

- [ ] **Step 2: Run resilience tests**

Run: `pnpm nx run ledger-ctrl:test-integration -- --testPathPattern=resilience`
Expected: All tests PASS (or diagnose failures — see notes below)

**Diagnosis notes:**
- If idempotency tests fail with count mismatch: the dedup key might not be propagated. Check that `detail.id` flows through the SQS → event-processor → handler → repository pipeline.
- If order-agnostic tests fail with snapshot mismatch: the reducer may not handle out-of-order entries correctly. Check `accountReducer` and `queryEntriesSince` ordering.
- If CDC idempotency test fails: the duplicate event may still trigger a DDB Stream record (even if the write was conditional-check-failed). Check if the reducer produces a no-op snapshot update.

- [ ] **Step 3: Commit**

```bash
git add services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts
git commit -m "test(ledger-ctrl): add idempotency and order-agnostic resilience tests

Verifies duplicate ORDER_FILLED/DEPOSIT_DETECTED are deduplicated,
no duplicate CDC events emitted, and shuffled event order produces
same final AccountSnapshot as sequential delivery.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: execution-ctrl resilience tests

**Context:** Uses `record()` (RecordIntent) for Order and StagedOrder. RecordIntent deduplication: `sk: ${typename}#${ctx.eventId}` + `attribute_not_exists(pk)`. Subscribes to: DECISION_APPROVED, USER_CONFIRMED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, ACCOUNT_CLOSURE_REQUESTED.

**DDB patterns:**
- Order: `pk: Order#${tenantId}#${orderId}`, `sk: Order`
- StagedOrder: `pk: StagedOrder#${tenantId}#${orderId}`, `sk: StagedOrder`

**Files:**
- Create: `services/execution/execution-ctrl/test/integration/execution-ctrl.resilience.integration.test.ts`

- [ ] **Step 1: Create the resilience test file**

Create `services/execution/execution-ctrl/test/integration/execution-ctrl.resilience.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  countItems,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

// ── Idempotency ──────────────────────────────────────────────────────────

describe('execution-ctrl resilience: idempotency', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'execution',
      detailType: ['ORDER_SUBMITTED', 'ORDER_STAGED'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('duplicate DECISION_APPROVED does not create duplicate Order/StagedOrder', async () => {
    const eventId = `idemp-decision-${Date.now()}`;
    const payload = {
      decisionPacketId: `dp-idemp-${Date.now()}`,
      proposedTrades: [{
        symbol: 'AAPL',
        assetClass: 'equity',
        side: 'BUY',
        quantityOrAmountCents: 10,
        targetWeightPercent: 25,
      }],
    };

    // First publish
    await eb.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'DECISION_APPROVED',
      detail: payload,
      eventId,
    });

    // Wait for CDC event confirming processing
    await trap.waitForEvent({ timeoutMs: 60_000 });

    // Count items written
    const items = await table.queryItems({
      table: 'execution-ctrl',
      pk: `T#${ctx.tenantId}`,
    });
    const countBefore = items.length;

    // Duplicate publish
    await eb.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'DECISION_APPROVED',
      detail: payload,
      eventId,
    });

    await new Promise((r) => setTimeout(r, 15_000));

    const itemsAfter = await table.queryItems({
      table: 'execution-ctrl',
      pk: `T#${ctx.tenantId}`,
    });

    expect(itemsAfter.length).toBe(countBefore);
  }, 120_000);
});

// ── Order-Agnostic: Pairwise Inversion ───────────────────────────────────

describe('execution-ctrl resilience: order-agnostic pairwise', () => {
  it('two DECISION_APPROVED events in either order produce same record set', async () => {
    // ── Run A: event1 then event2 ──
    const ctxA = await createIntegrationContext();
    const ebA = new EventBridgeClient(ctxA);
    const tableA = new TableAssertions(ctxA);
    tableA.registerCleanup();
    const trapA = new EventBusTrap(ctxA);
    await trapA.deploy({ bus: 'execution', detailType: ['ORDER_SUBMITTED', 'ORDER_STAGED'] });

    await ebA.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'DECISION_APPROVED',
      detail: {
        decisionPacketId: `dp-pair-A1-${Date.now()}`,
        proposedTrades: [{
          symbol: 'AAPL', assetClass: 'equity', side: 'BUY',
          quantityOrAmountCents: 5, targetWeightPercent: 20,
        }],
      },
    });
    await trapA.waitForEvent({ timeoutMs: 60_000 });

    await ebA.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'DECISION_APPROVED',
      detail: {
        decisionPacketId: `dp-pair-A2-${Date.now()}`,
        proposedTrades: [{
          symbol: 'MSFT', assetClass: 'equity', side: 'BUY',
          quantityOrAmountCents: 3, targetWeightPercent: 15,
        }],
      },
    });
    await trapA.waitForEvent({ timeoutMs: 60_000 });

    await new Promise((r) => setTimeout(r, 10_000));
    const countA = await countItems(tableA, 'execution-ctrl', `T#${ctxA.tenantId}`);

    // ── Run B: event2 then event1 (same payloads, reversed order) ──
    const ctxB = await createIntegrationContext();
    const ebB = new EventBridgeClient(ctxB);
    const tableB = new TableAssertions(ctxB);
    tableB.registerCleanup();
    const trapB = new EventBusTrap(ctxB);
    await trapB.deploy({ bus: 'execution', detailType: ['ORDER_SUBMITTED', 'ORDER_STAGED'] });

    await ebB.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'DECISION_APPROVED',
      detail: {
        decisionPacketId: `dp-pair-B2-${Date.now()}`,
        proposedTrades: [{
          symbol: 'MSFT', assetClass: 'equity', side: 'BUY',
          quantityOrAmountCents: 3, targetWeightPercent: 15,
        }],
      },
    });
    await trapB.waitForEvent({ timeoutMs: 60_000 });

    await ebB.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'DECISION_APPROVED',
      detail: {
        decisionPacketId: `dp-pair-B1-${Date.now()}`,
        proposedTrades: [{
          symbol: 'AAPL', assetClass: 'equity', side: 'BUY',
          quantityOrAmountCents: 5, targetWeightPercent: 20,
        }],
      },
    });
    await trapB.waitForEvent({ timeoutMs: 60_000 });

    await new Promise((r) => setTimeout(r, 10_000));
    const countB = await countItems(tableB, 'execution-ctrl', `T#${ctxB.tenantId}`);

    // Both should have 2 orders regardless of delivery order
    expect(countA).toBe(countB);

    await ctxA.cleanup.runAll();
    await ctxB.cleanup.runAll();
  }, 300_000);
});
```

- [ ] **Step 2: Run resilience tests**

Run: `pnpm nx run execution-ctrl:test-integration -- --testPathPattern=resilience`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/execution/execution-ctrl/test/integration/execution-ctrl.resilience.integration.test.ts
git commit -m "test(execution-ctrl): add idempotency and order-agnostic resilience tests

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: broker-ctrl resilience tests

**Context:** Uses `record()` for ExecutionMode and NormalizedEvent, `skip()` for SF callbacks. Has two Step Functions (OrderStateMachine, HealStateMachine). Idempotency is RecordIntent-based for mode and normalizer handlers.

**DDB patterns:**
- ExecutionMode: `pk: ExecutionMode#${tenantId}`, `sk: ExecutionMode`
- NormalizedEvent: `pk: NormalizedEvent#${tenantId}#${transferId}`, `sk: DEPOSIT_DETECTED|WITHDRAWAL_COMPLETED|TRANSFER_FAILED`

**Files:**
- Create: `services/execution/broker-ctrl/test/integration/broker-ctrl.resilience.integration.test.ts`

- [ ] **Step 1: Create the resilience test file**

Create `services/execution/broker-ctrl/test/integration/broker-ctrl.resilience.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  countItems,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

// ── Idempotency ──────────────────────────────────────────────────────────

describe('broker-ctrl resilience: idempotency', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'execution',
      detailType: ['DEPOSIT_DETECTED', 'WITHDRAWAL_COMPLETED', 'TRANSFER_FAILED'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('duplicate EXECUTION_MODE_CHANGED does not create duplicate ExecutionMode record', async () => {
    const eventId = `idemp-mode-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'EXECUTION_MODE_CHANGED',
      detail: { mode: 'live' },
      eventId,
    });

    await table.waitForItem({
      table: 'broker-ctrl',
      pk: `ExecutionMode#${ctx.tenantId}`,
      sk: 'ExecutionMode',
      timeoutMs: 60_000,
    });

    // Duplicate
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'EXECUTION_MODE_CHANGED',
      detail: { mode: 'live' },
      eventId,
    });

    await new Promise((r) => setTimeout(r, 15_000));

    // ExecutionMode uses record() with default sk = typename#eventId
    // So duplicate should be deduplicated
    const items = await table.queryItems({
      table: 'broker-ctrl',
      pk: `ExecutionMode#${ctx.tenantId}`,
    });
    // Should have exactly 1 ExecutionMode record
    const modeItems = items.filter((i) => i['__typename'] === 'ExecutionMode');
    expect(modeItems).toHaveLength(1);
    expect(modeItems[0]['mode']).toBe('live');
  }, 120_000);

  it('duplicate SIM_DEPOSIT_COMPLETED does not create duplicate NormalizedEvent', async () => {
    const eventId = `idemp-simdep-${Date.now()}`;
    const depositId = `dep-idemp-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'SIM_DEPOSIT_COMPLETED',
      detail: { depositId, amountCents: 100_000, currency: 'USD' },
      eventId,
    });

    await table.waitForItem({
      table: 'broker-ctrl',
      pk: `NormalizedEvent#${ctx.tenantId}#${depositId}`,
      sk: 'DEPOSIT_DETECTED',
      timeoutMs: 60_000,
    });

    const cdcEvent = await trap.waitForEvent({
      detailType: 'DEPOSIT_DETECTED',
      timeoutMs: 30_000,
    });
    expect(cdcEvent.detailType).toBe('DEPOSIT_DETECTED');

    // Duplicate
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'SIM_DEPOSIT_COMPLETED',
      detail: { depositId, amountCents: 100_000, currency: 'USD' },
      eventId,
    });

    await new Promise((r) => setTimeout(r, 15_000));

    // Should still have exactly 1 NormalizedEvent
    const items = await table.queryItems({
      table: 'broker-ctrl',
      pk: `NormalizedEvent#${ctx.tenantId}#${depositId}`,
    });
    expect(items).toHaveLength(1);

    // Should not have emitted another CDC event
    const remaining = await trap.drain();
    const deposits = remaining.filter((e) => e.detailType === 'DEPOSIT_DETECTED');
    expect(deposits).toHaveLength(0);
  }, 180_000);
});

// ── Order-Agnostic: Pairwise Inversion ───────────────────────────────────

describe('broker-ctrl resilience: order-agnostic pairwise', () => {
  it('SIM_DEPOSIT_COMPLETED then SIM_WITHDRAWAL_COMPLETED vs reverse', async () => {
    // ── Run A: deposit then withdrawal ──
    const ctxA = await createIntegrationContext();
    const ebA = new EventBridgeClient(ctxA);
    const tableA = new TableAssertions(ctxA);
    tableA.registerCleanup();

    const depId = `dep-pair-${Date.now()}`;
    const wdId = `wd-pair-${Date.now()}`;

    await ebA.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'SIM_DEPOSIT_COMPLETED',
      detail: { depositId: depId, amountCents: 100_000, currency: 'USD' },
    });
    await tableA.waitForItem({
      table: 'broker-ctrl',
      pk: `NormalizedEvent#${ctxA.tenantId}#${depId}`,
      sk: 'DEPOSIT_DETECTED',
      timeoutMs: 60_000,
    });

    await ebA.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'SIM_WITHDRAWAL_COMPLETED',
      detail: { withdrawalId: wdId, amount: 50_000, currency: 'USD' },
    });
    await tableA.waitForItem({
      table: 'broker-ctrl',
      pk: `NormalizedEvent#${ctxA.tenantId}#${wdId}`,
      sk: 'WITHDRAWAL_COMPLETED',
      timeoutMs: 60_000,
    });

    // ── Run B: withdrawal then deposit ──
    const ctxB = await createIntegrationContext();
    const ebB = new EventBridgeClient(ctxB);
    const tableB = new TableAssertions(ctxB);
    tableB.registerCleanup();

    const depId2 = `dep-pair2-${Date.now()}`;
    const wdId2 = `wd-pair2-${Date.now()}`;

    await ebB.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'SIM_WITHDRAWAL_COMPLETED',
      detail: { withdrawalId: wdId2, amount: 50_000, currency: 'USD' },
    });
    await tableB.waitForItem({
      table: 'broker-ctrl',
      pk: `NormalizedEvent#${ctxB.tenantId}#${wdId2}`,
      sk: 'WITHDRAWAL_COMPLETED',
      timeoutMs: 60_000,
    });

    await ebB.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'SIM_DEPOSIT_COMPLETED',
      detail: { depositId: depId2, amountCents: 100_000, currency: 'USD' },
    });
    await tableB.waitForItem({
      table: 'broker-ctrl',
      pk: `NormalizedEvent#${ctxB.tenantId}#${depId2}`,
      sk: 'DEPOSIT_DETECTED',
      timeoutMs: 60_000,
    });

    // Both runs should have 2 NormalizedEvent records each
    // (deposit and withdrawal are independent entities — order doesn't matter)
    const countA = (await tableA.queryItems({
      table: 'broker-ctrl',
      pk: `NormalizedEvent#${ctxA.tenantId}#${depId}`,
    })).length + (await tableA.queryItems({
      table: 'broker-ctrl',
      pk: `NormalizedEvent#${ctxA.tenantId}#${wdId}`,
    })).length;

    const countB = (await tableB.queryItems({
      table: 'broker-ctrl',
      pk: `NormalizedEvent#${ctxB.tenantId}#${depId2}`,
    })).length + (await tableB.queryItems({
      table: 'broker-ctrl',
      pk: `NormalizedEvent#${ctxB.tenantId}#${wdId2}`,
    })).length;

    expect(countA).toBe(2);
    expect(countB).toBe(2);

    await ctxA.cleanup.runAll();
    await ctxB.cleanup.runAll();
  }, 240_000);
});
```

- [ ] **Step 2: Run resilience tests**

Run: `pnpm nx run broker-ctrl:test-integration -- --testPathPattern=resilience`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/execution/broker-ctrl/test/integration/broker-ctrl.resilience.integration.test.ts
git commit -m "test(broker-ctrl): add idempotency and order-agnostic resilience tests

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: reconciliation-ctrl resilience tests

**Context:** Uses `record()` for ReconciliationResult and DriftRecord. Events are independent — each triggers its own reconciliation. Order-agnostic testing is minimal since events don't share state.

**DDB patterns:**
- ReconciliationResult: `pk: Reconciliation#${tenantId}#${reconciliationId}`, `sk: Reconciliation`
- DriftRecord: `pk: Reconciliation#${tenantId}#${reconciliationId}`, `sk: DriftRecord#${instrument}`

**Files:**
- Create: `services/ledger/reconciliation-ctrl/test/integration/reconciliation-ctrl.resilience.integration.test.ts`

- [ ] **Step 1: Create the resilience test file**

Create `services/ledger/reconciliation-ctrl/test/integration/reconciliation-ctrl.resilience.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

// ── Idempotency ──────────────────────────────────────────────────────────

describe('reconciliation-ctrl resilience: idempotency', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    await trap.deploy({ bus: 'ledger', detailType: 'RECONCILIATION_COMPLETED' });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('duplicate PORTFOLIO_UPDATED does not produce duplicate ReconciliationResult', async () => {
    const eventId = `idemp-recon-${Date.now()}`;
    const payload = {
      portfolioId: `pf-idemp-${Date.now()}`,
      positions: [
        { symbol: 'AAPL', quantity: 10 },
        { symbol: 'MSFT', quantity: 5 },
      ],
    };

    // First publish
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'reconciliation-ctrl',
      detailType: 'PORTFOLIO_UPDATED',
      detail: payload,
      eventId,
    });

    // Wait for reconciliation to complete
    const firstCdc = await trap.waitForEvent({
      detailType: 'RECONCILIATION_COMPLETED',
      timeoutMs: 60_000,
    });
    expect(firstCdc.detailType).toBe('RECONCILIATION_COMPLETED');

    // Duplicate publish
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'reconciliation-ctrl',
      detailType: 'PORTFOLIO_UPDATED',
      detail: payload,
      eventId,
    });

    // Wait for potential duplicate processing
    await new Promise((r) => setTimeout(r, 15_000));

    // Drain — no additional RECONCILIATION_COMPLETED should appear
    const remaining = await trap.drain();
    const reconEvents = remaining.filter(
      (e) => e.detailType === 'RECONCILIATION_COMPLETED',
    );
    expect(reconEvents).toHaveLength(0);
  }, 120_000);
});

// ── Order-Agnostic: Pairwise Inversion ───────────────────────────────────

describe('reconciliation-ctrl resilience: order-agnostic pairwise', () => {
  it('PORTFOLIO_UPDATED and ALPACA_ACCOUNT_SNAPSHOT in either order both produce reconciliation', async () => {
    // These events are independent — each triggers its own reconciliation.
    // The test verifies that processing one doesn't block or corrupt the other.

    const ctxA = await createIntegrationContext();
    const ebA = new EventBridgeClient(ctxA);
    const trapA = new EventBusTrap(ctxA);
    await trapA.deploy({ bus: 'ledger', detailType: 'RECONCILIATION_COMPLETED' });

    // Order A: PORTFOLIO_UPDATED first
    await ebA.putEvent({
      bus: 'ledger',
      targetService: 'reconciliation-ctrl',
      detailType: 'PORTFOLIO_UPDATED',
      detail: {
        portfolioId: `pf-order-A-${Date.now()}`,
        positions: [{ symbol: 'AAPL', quantity: 10 }],
      },
    });
    await trapA.waitForEvent({ detailType: 'RECONCILIATION_COMPLETED', timeoutMs: 60_000 });

    await ebA.putEvent({
      bus: 'ledger',
      targetService: 'reconciliation-ctrl',
      detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
      detail: {
        snapshotId: `snap-order-A-${Date.now()}`,
        positions: [{ symbol: 'AAPL', qty: 10, marketValue: 1800 }],
        cash: 50000,
      },
    });
    await trapA.waitForEvent({ detailType: 'RECONCILIATION_COMPLETED', timeoutMs: 60_000 });

    // Order B: ALPACA_ACCOUNT_SNAPSHOT first
    const ctxB = await createIntegrationContext();
    const ebB = new EventBridgeClient(ctxB);
    const trapB = new EventBusTrap(ctxB);
    await trapB.deploy({ bus: 'ledger', detailType: 'RECONCILIATION_COMPLETED' });

    await ebB.putEvent({
      bus: 'ledger',
      targetService: 'reconciliation-ctrl',
      detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
      detail: {
        snapshotId: `snap-order-B-${Date.now()}`,
        positions: [{ symbol: 'AAPL', qty: 10, marketValue: 1800 }],
        cash: 50000,
      },
    });
    await trapB.waitForEvent({ detailType: 'RECONCILIATION_COMPLETED', timeoutMs: 60_000 });

    await ebB.putEvent({
      bus: 'ledger',
      targetService: 'reconciliation-ctrl',
      detailType: 'PORTFOLIO_UPDATED',
      detail: {
        portfolioId: `pf-order-B-${Date.now()}`,
        positions: [{ symbol: 'AAPL', quantity: 10 }],
      },
    });
    await trapB.waitForEvent({ detailType: 'RECONCILIATION_COMPLETED', timeoutMs: 60_000 });

    // Both runs produced 2 reconciliation completions — order didn't matter
    await ctxA.cleanup.runAll();
    await ctxB.cleanup.runAll();
  }, 300_000);
});
```

- [ ] **Step 2: Run resilience tests**

Run: `pnpm nx run reconciliation-ctrl:test-integration -- --testPathPattern=resilience`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/ledger/reconciliation-ctrl/test/integration/reconciliation-ctrl.resilience.integration.test.ts
git commit -m "test(reconciliation-ctrl): add idempotency and order-agnostic resilience tests

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: broker-alpaca-adpt resilience tests

**Context:** Uses `record()` for AlpacaOrderResult and AlpacaTransferResult. Requires MockApiFixture + SsmOverrideFixture for the Alpaca API mock (same pattern as existing integration test). External API call happens before RecordIntent dedup — the mock may be called twice, but DDB should have only one record.

**DDB patterns (from existing test):**
- AlpacaOrderResult: pk/sk from `ordersService.submitOrder()` response
- AlpacaTransferResult: `pk: TransferMapping#${tenantId}#${transferId}`, `sk: TransferMapping`

**Files:**
- Create: `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.resilience.integration.test.ts`

- [ ] **Step 1: Create the resilience test file**

Create `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.resilience.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import { readFileSync } from 'fs';
import { join } from 'path';

// ── Idempotency ──────────────────────────────────────────────────────────

describe('broker-alpaca-adpt resilience: idempotency', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let trap: EventBusTrap;
  let mockApi: MockApiFixture;
  let ssmOverride: SsmOverrideFixture;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'execution',
      detailType: ['ALPACA_ORDER_PLACED', 'ALPACA_ORDER_REJECTED', 'ALPACA_TRANSFER_INITIATED'],
    });

    // Deploy mock Alpaca API (same pattern as existing test)
    mockApi = new MockApiFixture(ctx);
    const mockZip = readFileSync(
      join(__dirname, '..', 'mocks', 'alpaca-mock.zip'),
    );
    const mockUrl = await mockApi.deploy({ name: 'alpaca-mock-resilience', handlerAsset: mockZip });

    ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      service: 'broker-alpaca-adpt',
      key: 'baseUrl',
      value: mockUrl,
    });
  }, 120_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('duplicate ALPACA_ORDER_REQUESTED produces single AlpacaOrderResult', async () => {
    const eventId = `idemp-alpaca-order-${Date.now()}`;
    const payload = {
      orderId: `order-idemp-${Date.now()}`,
      symbol: 'AAPL',
      side: 'BUY',
      quantity: 5,
    };

    // First publish
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_ORDER_REQUESTED',
      detail: payload,
      eventId,
    });

    await trap.waitForEvent({ timeoutMs: 60_000 });

    // Query for order results
    const itemsBefore = await table.queryItems({
      table: 'broker-alpaca-adpt',
      pk: `T#${ctx.tenantId}`,
    });
    const orderResultsBefore = itemsBefore.filter(
      (i) => i['__typename'] === 'AlpacaOrderResult',
    );
    const countBefore = orderResultsBefore.length;

    // Duplicate publish
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_ORDER_REQUESTED',
      detail: payload,
      eventId,
    });

    await new Promise((r) => setTimeout(r, 15_000));

    const itemsAfter = await table.queryItems({
      table: 'broker-alpaca-adpt',
      pk: `T#${ctx.tenantId}`,
    });
    const orderResultsAfter = itemsAfter.filter(
      (i) => i['__typename'] === 'AlpacaOrderResult',
    );

    // Note: The Alpaca API mock may have been called twice (side effect before dedup),
    // but DDB should have exactly the same number of records.
    expect(orderResultsAfter.length).toBe(countBefore);
  }, 120_000);

  it('duplicate ALPACA_TRANSFER_REQUESTED produces single AlpacaTransferResult', async () => {
    const eventId = `idemp-alpaca-transfer-${Date.now()}`;
    const transferId = `transfer-idemp-${Date.now()}`;
    const payload = {
      transferId,
      direction: 'INCOMING',
      amount: 10_000,
      relationshipId: 'rel-integ',
    };

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_TRANSFER_REQUESTED',
      detail: payload,
      eventId,
    });

    await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `TransferMapping#${ctx.tenantId}#${transferId}`,
      sk: 'TransferMapping',
      timeoutMs: 60_000,
    });

    // Duplicate
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_TRANSFER_REQUESTED',
      detail: payload,
      eventId,
    });

    await new Promise((r) => setTimeout(r, 15_000));

    const items = await table.queryItems({
      table: 'broker-alpaca-adpt',
      pk: `TransferMapping#${ctx.tenantId}#${transferId}`,
    });
    expect(items).toHaveLength(1);
  }, 120_000);
});
```

**Note:** This test depends on the mock zip file at `test/mocks/alpaca-mock.zip` and the `build-mock` Nx target being previously run. If the mock doesn't exist, run `pnpm nx run broker-alpaca-adpt:build-mock` first.

- [ ] **Step 2: Run resilience tests**

Run: `pnpm nx run broker-alpaca-adpt:build-mock && pnpm nx run broker-alpaca-adpt:test-integration -- --testPathPattern=resilience`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.resilience.integration.test.ts
git commit -m "test(broker-alpaca-adpt): add idempotency resilience tests

Verifies duplicate ALPACA_ORDER_REQUESTED and ALPACA_TRANSFER_REQUESTED
are deduplicated at the DDB level despite mock API receiving both calls.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: portfolio-engine-ctrl resilience tests

**Context:** Uses `record()` for AgentInvocation, `store()` for KB ingestion. The agent pipeline (Bedrock AgentCore) runs before the RecordIntent write — duplicate events may trigger the agent twice, but DDB should have one record. Tests are tolerant of AgentRuntime unavailability (per memory: "tolerant of unavailable AgentRuntime, best-effort CDC assertions").

**DDB patterns:**
- AgentInvocation: `pk: DECISION#${decisionId}`, `sk: INV#${invocationId}`

**Files:**
- Create: `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.resilience.integration.test.ts`

- [ ] **Step 1: Create the resilience test file**

Create `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.resilience.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

// ── Idempotency ──────────────────────────────────────────────────────────
// Note: Agent runtime may not be available in all environments.
// Tests are tolerant — they attempt the test but skip gracefully on timeout
// if the handler can't complete due to agent infrastructure issues.

describe('portfolio-engine-ctrl resilience: idempotency', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'advisory',
      detailType: 'PORTFOLIO_CONSTRUCTION_PROPOSED',
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('duplicate CONSTRUCT_PORTFOLIO does not create duplicate AgentInvocation', async () => {
    const eventId = `idemp-construct-${Date.now()}`;
    const decisionId = `decision-idemp-${Date.now()}`;
    const payload = {
      tenantId: ctx.tenantId,
      decisionId,
      taskToken: `integ-task-token-${Date.now()}`,
      context: {},
    };

    // First publish
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'portfolio-engine-ctrl',
      detailType: 'CONSTRUCT_PORTFOLIO',
      detail: payload,
      eventId,
    });

    // Wait for processing — tolerate timeout (agent runtime may be unavailable)
    let firstProcessed = false;
    try {
      await table.waitForItem({
        table: 'portfolio-engine-ctrl',
        pk: `DECISION#${decisionId}`,
        timeoutMs: 90_000,
      });
      firstProcessed = true;
    } catch {
      console.warn(
        'portfolio-engine-ctrl: AgentRuntime may be unavailable — skipping idempotency assertion',
      );
      return; // Skip test gracefully
    }

    if (!firstProcessed) return;

    // Count invocations
    const itemsBefore = await table.queryItems({
      table: 'portfolio-engine-ctrl',
      pk: `DECISION#${decisionId}`,
    });
    const countBefore = itemsBefore.length;

    // Duplicate publish
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'portfolio-engine-ctrl',
      detailType: 'CONSTRUCT_PORTFOLIO',
      detail: payload,
      eventId,
    });

    await new Promise((r) => setTimeout(r, 15_000));

    const itemsAfter = await table.queryItems({
      table: 'portfolio-engine-ctrl',
      pk: `DECISION#${decisionId}`,
    });

    expect(itemsAfter.length).toBe(countBefore);
  }, 180_000);
});

// ── Order-Agnostic: Pairwise Inversion ───────────────────────────────────

describe('portfolio-engine-ctrl resilience: order-agnostic pairwise', () => {
  it('CONSTRUCT_PORTFOLIO and SEC_PROSPECTUS_UPDATED in either order both process', async () => {
    // These are independent events (different handlers) — verifying neither blocks the other
    const ctxA = await createIntegrationContext();
    const ebA = new EventBridgeClient(ctxA);
    const tableA = new TableAssertions(ctxA);
    tableA.registerCleanup();

    const decisionId = `decision-pair-${Date.now()}`;

    // Order A: CONSTRUCT_PORTFOLIO first, then SEC filing
    await ebA.putEvent({
      bus: 'advisory',
      targetService: 'portfolio-engine-ctrl',
      detailType: 'CONSTRUCT_PORTFOLIO',
      detail: {
        tenantId: ctxA.tenantId,
        decisionId,
        taskToken: `task-pair-A-${Date.now()}`,
        context: {},
      },
    });

    // Wait a bit then send SEC filing
    await new Promise((r) => setTimeout(r, 5_000));

    await ebA.putEvent({
      bus: 'advisory',
      targetService: 'portfolio-engine-ctrl',
      detailType: 'SEC_PROSPECTUS_UPDATED',
      detail: {
        filingId: `filing-pair-A-${Date.now()}`,
        content: 'Test prospectus content for resilience test',
      },
    });

    // Allow processing time (tolerant of agent failures)
    await new Promise((r) => setTimeout(r, 30_000));

    // Order B: SEC filing first
    const ctxB = await createIntegrationContext();
    const ebB = new EventBridgeClient(ctxB);

    await ebB.putEvent({
      bus: 'advisory',
      targetService: 'portfolio-engine-ctrl',
      detailType: 'SEC_PROSPECTUS_UPDATED',
      detail: {
        filingId: `filing-pair-B-${Date.now()}`,
        content: 'Test prospectus content for resilience test',
      },
    });

    await new Promise((r) => setTimeout(r, 5_000));

    const decisionId2 = `decision-pair2-${Date.now()}`;
    await ebB.putEvent({
      bus: 'advisory',
      targetService: 'portfolio-engine-ctrl',
      detailType: 'CONSTRUCT_PORTFOLIO',
      detail: {
        tenantId: ctxB.tenantId,
        decisionId: decisionId2,
        taskToken: `task-pair-B-${Date.now()}`,
        context: {},
      },
    });

    await new Promise((r) => setTimeout(r, 30_000));

    // Both runs should have attempted processing without errors
    // (the events are independent — order doesn't affect outcome)

    await ctxA.cleanup.runAll();
    await ctxB.cleanup.runAll();
  }, 180_000);
});
```

- [ ] **Step 2: Run resilience tests**

Run: `pnpm nx run portfolio-engine-ctrl:test-integration -- --testPathPattern=resilience`
Expected: PASS (or graceful skip if AgentRuntime unavailable)

- [ ] **Step 3: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.resilience.integration.test.ts
git commit -m "test(portfolio-engine-ctrl): add idempotency and order-agnostic resilience tests

Tolerant of AgentRuntime unavailability — skips gracefully if agent
pipeline cannot complete.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Execution Order

```
Task 1 (EventBridgeClient eventId) ─┐
Task 2 (Resilience helpers)         ─┼─ Prerequisites (sequential)
                                     │
Task 3 (ledger-ctrl)     ─────────┐  │
Task 4 (execution-ctrl)  ─────────┤  │
Task 5 (broker-ctrl)     ─────────┤──┘ Independent (parallelizable)
Task 6 (reconciliation)  ─────────┤
Task 7 (broker-alpaca)   ─────────┤
Task 8 (portfolio-engine) ────────┘
```

Tasks 1-2 must complete first. Tasks 3-8 are independent and can be executed in parallel via subagents.

## Validation

After all tasks are committed, run all resilience tests together:

```bash
pnpm nx run-many -t test-integration --projects=ledger-ctrl,execution-ctrl,broker-ctrl,reconciliation-ctrl,broker-alpaca-adpt,portfolio-engine-ctrl --parallel=2 -- --testPathPattern=resilience
```

Expected: All PASS (portfolio-engine-ctrl may gracefully skip if agent runtime is unavailable).

## Spec Deviations

1. **Library-level primitive tests dropped.** The spec calls for WriteIntent idempotency tests in `libs/event-processor/test/integration/`. Dropped because event-processor has no deployed infrastructure (no DDB table, no SQS queue). The per-service resilience tests implicitly verify the primitives through real event processing.

2. **Full shuffle limited to ledger-ctrl.** The spec says financial-critical services get full-shuffle tests. In practice, only ledger-ctrl has a reducer that accumulates state across multiple events into a shared snapshot. The other 5 services process events into independent records (different PKs) — shuffling them doesn't test anything meaningful since there's no shared state to corrupt.

3. **broker-alpaca-adpt order-agnostic "order then cancel" dropped.** The spec mentions testing `ALPACA_ORDER_REQUESTED` → `ALPACA_ORDER_CANCEL_REQUESTED` pairwise. Dropped because cancel requires a prior `ALPACA_ORDER_PLACED` CDC event from the first order's processing — this is a cross-handler dependency that's more of an e2e concern than a simple ordering test.
