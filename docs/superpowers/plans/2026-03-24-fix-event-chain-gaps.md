# Fix Event Chain Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 confirmed issues: 3 broken CDC event chains, 3 missing notifications, 1 missing staged-order lifecycle — plus update data-flow documentation. (S2/DECISION_BLOCKED recovery was dropped — idempotency is per-event, not per-tenant, so new trigger events already create fresh decision packets.)

**Architecture:** CDC fixes follow the established pattern: handler returns `record('TypeName', data)` → `IngestionEngine` (inside `createIngestionHandler`) writes to DDB via `TABLE_NAME` env → DDB Stream triggers event-publisher Lambda → `buildEventTypeMap` with `customMap` override maps to semantic event names. The `changeDataCapture` eventTypeMap supports function resolvers for status-based routing. Notification fixes add EVENT_TYPES + templates to investor-ctrl. Staged-order fix adds a scheduled Lambda.

**Tech Stack:** TypeScript, AWS CDK, DynamoDB Streams, EventBridge, SQS, event-processor lib (`buildEventTypeMap`, `changeDataCapture`, `materializeToTable`, `record`, `skip`)

---

## File Map

### Wave 1: Critical CDC Fixes

| File | Action | Responsibility |
|------|--------|---------------|
| `services/execution/execution-ctrl/src/handlers/event-publisher.ts` | Modify | Add function-based `customMap` for Order status → event type |
| `services/execution/execution-ctrl/test/event-publisher.test.ts` | Modify | Add CDC mapping tests |
| `services/execution/broker-adpt/src/handlers/event-listener.ts` | Modify | Return `record()` instead of `skip()` for deposits/withdrawals |
| `services/execution/broker-adpt/src/handlers/event-publisher.ts` | Modify | Add `customMap` for DepositDetected/WithdrawalCompleted |
| `services/execution/broker-adpt/src/service.stack.ts` | Modify | Add publishableTypes |
| `services/execution/broker-adpt/test/event-listener.test.ts` | Modify | Assert `record()` return |
| `services/execution/broker-adpt/test/event-publisher.test.ts` | Modify | Add CDC mapping tests |

### Wave 2: Notification Fixes

| File | Action | Responsibility |
|------|--------|---------------|
| `services/execution/execution-adpt/src/service.stack.ts` | Modify | Add WITHDRAWAL_COMPLETED to ToInvestor rule |
| `services/investor/investor-ctrl/src/handlers/event-listener.ts` | Modify | Add 3 notification templates + EVENT_TYPES |
| `services/investor/investor-ctrl/src/service.stack.ts` | Modify | Add 3 event types to Ingress |
| `services/investor/investor-ctrl/test/event-listener.test.ts` | Modify | Add 3 notification tests |

### Wave 3: Staged Order Lifecycle

| File | Action | Responsibility |
|------|--------|---------------|
| `services/execution/execution-ctrl/src/handlers/staged-order-processor.ts` | Create | Scheduled handler: query staged orders → submit |
| `services/execution/execution-ctrl/src/repositories/order.repository.ts` | Modify | Add `getAllStagedOrders()` scan method |
| `services/execution/execution-ctrl/src/service.stack.ts` | Modify | Add EventBridge Schedule + Lambda |
| `services/execution/execution-ctrl/test/staged-order-processor.test.ts` | Create | Unit tests |

### ~~Wave 4: Decision Blocked Recovery~~ — DROPPED

S2 was a false alarm. Advisory-ctrl idempotency is keyed by `eventId` (per-event), not per-tenant. New trigger events (e.g., GOAL_UPDATED after a BLOCKED decision) already create fresh decision packets. No code change needed.

### Wave 4: Documentation

| File | Action | Responsibility |
|------|--------|---------------|
| `docs/data-flows/08-order-execution.md` | Modify | Reflect CDC function-based mapping |
| `docs/data-flows/09-order-ledger.md` | Modify | Revert C3 false-alarm edit |
| `docs/data-flows/13-portfolio-rebalancing.md` | Modify | Update broker-adpt description |

---

## Wave 1: Critical CDC Fixes

### Task 1: Fix execution-ctrl CDC event type mapping (C4)

**Context:** `execution-ctrl` writes Order records with varying `status` values (SUBMITTED, STAGED, REJECTED). The CDC event-publisher uses `buildEventTypeMap(['Order', 'StagedOrder'])` with no custom overrides, producing `ORDER_CREATED` for all inserts. But broker-adpt Ingress expects `ORDER_SUBMITTED`, and execution-adpt forwarding rules expect `ORDER_REJECTED`, `ORDER_STAGED`. The `changeDataCapture` config supports function-based resolvers: `typeof resolver === 'function' ? resolver(record) : resolver`.

**Files:**
- Modify: `services/execution/execution-ctrl/src/handlers/event-publisher.ts`
- Test: `services/execution/execution-ctrl/test/event-publisher.test.ts`

- [ ] **Step 1: Write failing tests for status-based CDC mapping**

In `services/execution/execution-ctrl/test/event-publisher.test.ts`. Follow the existing CDC test pattern in `services/ledger/ledger-ctrl/test/event-publisher.test.ts` (uses `buildEventTypeMap` + `fakeDdbStreamRecord` to unit-test the map directly):

```typescript
import { buildEventTypeMap } from '@nestfolio/event-processor';
import type { StreamRecord } from '@nestfolio/event-processor';

describe('execution-ctrl CDC mapping', () => {
  // Replicate the event type map from event-publisher.ts
  const eventTypeMap: Record<string, string | ((r: StreamRecord) => string)> = {
    ...buildEventTypeMap(['Order', 'StagedOrder']),
    'Order:INSERT': (record: StreamRecord) => {
      switch (record['status']) {
        case 'SUBMITTED': return 'ORDER_SUBMITTED';
        case 'STAGED':    return 'ORDER_STAGED';
        case 'REJECTED':  return 'ORDER_REJECTED';
        default:          return 'ORDER_CREATED';
      }
    },
  };

  function resolveEventType(typename: string, eventName: string, record: StreamRecord): string | null {
    const key = `${typename}:${eventName}`;
    const resolver = eventTypeMap[key];
    if (!resolver) return null;
    return typeof resolver === 'function' ? resolver(record) : resolver;
  }

  it('should map Order INSERT with status=SUBMITTED to ORDER_SUBMITTED', () => {
    const result = resolveEventType('Order', 'INSERT', { __typename: 'Order', status: 'SUBMITTED' } as StreamRecord);
    expect(result).toBe('ORDER_SUBMITTED');
  });

  it('should map Order INSERT with status=STAGED to ORDER_STAGED', () => {
    const result = resolveEventType('Order', 'INSERT', { __typename: 'Order', status: 'STAGED' } as StreamRecord);
    expect(result).toBe('ORDER_STAGED');
  });

  it('should map Order INSERT with status=REJECTED to ORDER_REJECTED', () => {
    const result = resolveEventType('Order', 'INSERT', { __typename: 'Order', status: 'REJECTED' } as StreamRecord);
    expect(result).toBe('ORDER_REJECTED');
  });

  it('should map StagedOrder INSERT to STAGED_ORDER_CREATED', () => {
    const result = resolveEventType('StagedOrder', 'INSERT', { __typename: 'StagedOrder' } as StreamRecord);
    expect(result).toBe('STAGED_ORDER_CREATED');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test execution-ctrl --testPathPattern=event-publisher`
Expected: FAIL — current map produces `ORDER_CREATED` for all Order inserts.

- [ ] **Step 3: Implement function-based CDC mapping**

Replace `services/execution/execution-ctrl/src/handlers/event-publisher.ts`:

```typescript
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';
import type { StreamRecord } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'execution-ctrl',
  eventTypeMap: {
    ...buildEventTypeMap(['Order', 'StagedOrder']),
    'Order:INSERT': (record: StreamRecord) => {
      switch (record['status']) {
        case 'SUBMITTED': return 'ORDER_SUBMITTED';
        case 'STAGED':    return 'ORDER_STAGED';
        case 'REJECTED':  return 'ORDER_REJECTED';
        default:          return 'ORDER_CREATED';
      }
    },
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test execution-ctrl --testPathPattern=event-publisher`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/execution/execution-ctrl/src/handlers/event-publisher.ts services/execution/execution-ctrl/test/event-publisher.test.ts
git commit -m "fix(execution-ctrl): use function-based CDC mapping for Order status"
```

---

### Task 2: Fix broker-adpt to emit DEPOSIT_DETECTED (C1)

**Context:** broker-adpt handles `DEPOSIT_INITIATED` by writing to VirtualCashBalance via repository (direct DDB write), then returns `skip()`. CDC publishes `VIRTUAL_CASH_BALANCE_CREATED` which nobody listens for. The fix: handler should ALSO return a `record('DepositDetected', data)` so the materialize pipeline writes a dedicated DDB record that triggers CDC as `DEPOSIT_DETECTED`.

**Note:** broker-adpt uses `createIngestionHandler` which creates an `IngestionEngine` with `tableName` (defaults to `process.env['TABLE_NAME']`). This engine supports `record()` return values — no need to switch to `materializeToTable`.

**Files:**
- Modify: `services/execution/broker-adpt/src/handlers/event-listener.ts`
- Modify: `services/execution/broker-adpt/src/handlers/event-publisher.ts`
- Modify: `services/execution/broker-adpt/src/service.stack.ts`
- Test: `services/execution/broker-adpt/test/event-listener.test.ts`
- Test: `services/execution/broker-adpt/test/event-publisher.test.ts`

- [ ] **Step 1: Write failing test for DEPOSIT_INITIATED → record('DepositDetected')**

In `services/execution/broker-adpt/test/event-listener.test.ts`, add:

```typescript
describe('DEPOSIT_INITIATED handler', () => {
  it('should return DepositDetected record after processing', async () => {
    const record = fakeSqsRecord('DEPOSIT_INITIATED', {
      depositId: 'dep-1',
      amountCents: 10000,
      currency: 'USD',
      userId: 'user-1',
    }, { tenantId: 'tenant-1' });

    const result = await harness.process([record]);

    // Should NOT skip — should return a DepositDetected record
    expect(result.skipped).toBe(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({
      _tag: 'record',
      typename: 'DepositDetected',
      fields: expect.objectContaining({
        __typename: 'DepositDetected',
        depositId: 'dep-1',
        amountCents: 10000,
        currency: 'USD',
      }),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test broker-adpt --testPathPattern=event-listener`
Expected: FAIL — handler currently returns `skip()`.

- [ ] **Step 3: Modify handler to return `record()` for DEPOSIT_INITIATED**

In `services/execution/broker-adpt/src/handlers/event-listener.ts`, add `record` and `getTime` to imports (line 4):

```typescript
import { createIngestionHandler, skip, record, getTime, type EventPayload, type EventContext } from '@nestfolio/event-processor';
```

Replace the return at line 143 (`return skip()`) with:

```typescript
      return record('DepositDetected', {
        __typename: 'DepositDetected',
        tenantId,
        depositId,
        amountCents,
        currency,
        userId,
        sourceEventId: ctx.eventId,
        timestamp: getTime(),
      }, { pk: `DepositDetected#${tenantId}#${ctx.eventId}`, sk: 'DepositDetected' });
```

Also change the "already processed" return at line 139 from `return skip()` to return the same record (idempotent write — DDB PutItem is idempotent on same pk/sk).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test broker-adpt --testPathPattern=event-listener`
Expected: PASS

- [ ] **Step 5: Add DepositDetected to CDC mapping**

Modify `services/execution/broker-adpt/src/handlers/event-publisher.ts`:

```typescript
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'broker-adpt',
  eventTypeMap: buildEventTypeMap(
    ['VirtualTrade', 'VirtualCashBalance', 'VirtualPosition', 'DepositDetected', 'WithdrawalCompleted'],
    {
      'DepositDetected:INSERT': 'DEPOSIT_DETECTED',
      'WithdrawalCompleted:INSERT': 'WITHDRAWAL_COMPLETED',
    },
  ),
});
```

- [ ] **Step 6: Add DepositDetected to Egress publishableTypes**

Modify `services/execution/broker-adpt/src/service.stack.ts` line 13:

```typescript
    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['VirtualTrade', 'VirtualCashBalance', 'VirtualPosition', 'DepositDetected', 'WithdrawalCompleted'],
    });
```

- [ ] **Step 7: Write CDC test for DepositDetected mapping**

In `services/execution/broker-adpt/test/event-publisher.test.ts`:

```typescript
it('should map DepositDetected:INSERT to DEPOSIT_DETECTED', async () => {
  const record = fakeDdbStreamRecord('INSERT', {
    __typename: 'DepositDetected',
    tenantId: 't1',
    depositId: 'dep-1',
    amountCents: 10000,
  });
  const result = await harness.process([record]);
  expect(result.publishedEvents[0].eventType).toBe('DEPOSIT_DETECTED');
});
```

- [ ] **Step 8: Run all broker-adpt tests**

Run: `pnpm nx test broker-adpt`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add services/execution/broker-adpt/src/ services/execution/broker-adpt/test/
git commit -m "fix(broker-adpt): emit DEPOSIT_DETECTED via CDC after processing deposit"
```

---

### Task 3: Fix broker-adpt to emit WITHDRAWAL_COMPLETED (C2)

**Context:** Same pattern as Task 2. WITHDRAWAL_REQUESTED handler returns `skip()` after debiting VirtualCashBalance.

**Files:**
- Modify: `services/execution/broker-adpt/src/handlers/event-listener.ts` (already modified in Task 2 imports)
- Test: `services/execution/broker-adpt/test/event-listener.test.ts`

- [ ] **Step 1: Write failing test for WITHDRAWAL_REQUESTED → record('WithdrawalCompleted')**

```typescript
describe('WITHDRAWAL_REQUESTED handler', () => {
  it('should return WithdrawalCompleted record after processing', async () => {
    // Pre-seed sufficient balance in mock
    const record = fakeSqsRecord('WITHDRAWAL_REQUESTED', {
      withdrawalId: 'wth-1',
      amount: 50,
      userId: 'user-1',
    }, { tenantId: 'tenant-1' });

    const result = await harness.process([record]);

    expect(result.skipped).toBe(0);
    expect(result.intents[0]).toMatchObject({
      _tag: 'record',
      typename: 'WithdrawalCompleted',
      fields: expect.objectContaining({
        __typename: 'WithdrawalCompleted',
        withdrawalId: 'wth-1',
      }),
    });
  });

  it('should skip when insufficient balance', async () => {
    // No balance seeded
    const record = fakeSqsRecord('WITHDRAWAL_REQUESTED', {
      withdrawalId: 'wth-2',
      amount: 99999,
      userId: 'user-1',
    }, { tenantId: 'tenant-1' });

    const result = await harness.process([record]);
    expect(result.skipped).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test broker-adpt --testPathPattern=event-listener`
Expected: FAIL

- [ ] **Step 3: Modify handler to return `record()` for WITHDRAWAL_REQUESTED**

In `services/execution/broker-adpt/src/handlers/event-listener.ts`, replace the final `return skip()` at line 104 with:

```typescript
      return record('WithdrawalCompleted', {
        __typename: 'WithdrawalCompleted',
        tenantId,
        withdrawalId,
        amount,
        userId,
        sourceEventId: ctx.eventId,
        timestamp: getTime(),
      }, { pk: `WithdrawalCompleted#${tenantId}#${ctx.eventId}`, sk: 'WithdrawalCompleted' });
```

Keep the `return skip()` at line 100 (already-processed idempotency case) AND the `return skip()` at line 92 (insufficient balance — no withdrawal to complete).

- [ ] **Step 4: Write CDC test for WithdrawalCompleted mapping**

In `services/execution/broker-adpt/test/event-publisher.test.ts`:

```typescript
it('should map WithdrawalCompleted:INSERT to WITHDRAWAL_COMPLETED', async () => {
  const record = fakeDdbStreamRecord('INSERT', {
    __typename: 'WithdrawalCompleted',
    tenantId: 't1',
    withdrawalId: 'wth-1',
    amount: 50,
  });
  const result = await harness.process([record]);
  expect(result.publishedEvents[0].eventType).toBe('WITHDRAWAL_COMPLETED');
});
```

- [ ] **Step 5: Run all broker-adpt tests**

Run: `pnpm nx test broker-adpt`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add services/execution/broker-adpt/src/handlers/event-listener.ts services/execution/broker-adpt/test/
git commit -m "fix(broker-adpt): emit WITHDRAWAL_COMPLETED via CDC after processing withdrawal"
```

---

## Wave 2: Notification Fixes

### Task 4: Add WITHDRAWAL_COMPLETED forwarding to InvestorBus (M1)

**Context:** execution-adpt forwards events to InvestorBus, LedgerBus, AdvisoryBus via EventBridge Rules. WITHDRAWAL_COMPLETED is forwarded to LedgerBus (line 64) but NOT to InvestorBus. The user should be notified when a withdrawal completes.

**Files:**
- Modify: `services/execution/execution-adpt/src/service.stack.ts`

- [ ] **Step 1: Add WITHDRAWAL_COMPLETED to ToInvestor rule**

In `services/execution/execution-adpt/src/service.stack.ts`, add `ExecutionCrossDomainEventTypes.WITHDRAWAL_COMPLETED` to the ToInvestor rule detailType array (after line 44):

```typescript
    new Rule(this, 'ToInvestor', {
      eventBus: executionBus,
      eventPattern: {
        detailType: [
          ExecutionCrossDomainEventTypes.ORDER_STAGED,
          ExecutionCrossDomainEventTypes.ORDER_REJECTED,
          ExecutionCrossDomainEventTypes.ORDER_CANCELLED,
          ExecutionCrossDomainEventTypes.WITHDRAWAL_REJECTED,
          ExecutionCrossDomainEventTypes.WITHDRAWAL_COMPLETED,
        ],
      },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: toInvestorDlq })],
    });
```

- [ ] **Step 2: Run CDK synth to verify stack compiles**

Run: `pnpm nx build execution-adpt`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add services/execution/execution-adpt/src/service.stack.ts
git commit -m "fix(execution-adpt): forward WITHDRAWAL_COMPLETED to InvestorBus"
```

---

### Task 5: Add 3 notification templates to investor-ctrl (M1, M2, M3)

**Context:** investor-ctrl listens for 8 events and creates notifications. Three events are forwarded to InvestorBus but investor-ctrl doesn't listen: ORDER_REJECTED (from execution-adpt), DECISION_BLOCKED (from advisory-adpt), WITHDRAWAL_COMPLETED (from execution-adpt after Task 4). Add all three.

**Files:**
- Modify: `services/investor/investor-ctrl/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-ctrl/src/service.stack.ts`
- Test: `services/investor/investor-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Write failing tests for new notification templates**

In `services/investor/investor-ctrl/test/event-listener.test.ts`:

```typescript
it('should create notification for ORDER_REJECTED', async () => {
  const record = fakeSqsRecord('ORDER_REJECTED', {
    orderId: 'o1', reason: 'Safety check failed',
  }, { tenantId: 'tenant-1' });

  const result = await harness.process([record]);
  expect(result.intents[0]).toMatchObject({
    typename: 'Notification',
    fields: expect.objectContaining({
      title: 'Order Rejected',
      channel: 'push',
    }),
  });
});

it('should create notification for DECISION_BLOCKED', async () => {
  const record = fakeSqsRecord('DECISION_BLOCKED', {
    decisionId: 'd1', reason: 'Guardrail violation',
  }, { tenantId: 'tenant-1' });

  const result = await harness.process([record]);
  expect(result.intents[0]).toMatchObject({
    typename: 'Notification',
    fields: expect.objectContaining({
      title: 'Decision Blocked',
      channel: 'push',
    }),
  });
});

it('should create notification for WITHDRAWAL_COMPLETED', async () => {
  const record = fakeSqsRecord('WITHDRAWAL_COMPLETED', {
    withdrawalId: 'w1', amount: 500,
  }, { tenantId: 'tenant-1' });

  const result = await harness.process([record]);
  expect(result.intents[0]).toMatchObject({
    typename: 'Notification',
    fields: expect.objectContaining({
      title: 'Withdrawal Completed',
      channel: 'email',
    }),
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test investor-ctrl --testPathPattern=event-listener`
Expected: FAIL — events not in EVENT_TYPES array.

- [ ] **Step 3: Add notification templates**

In `services/investor/investor-ctrl/src/handlers/event-listener.ts`, add to `NOTIFICATION_TEMPLATES` (after line 53):

```typescript
  ORDER_REJECTED: {
    title: 'Order Rejected',
    body: 'A trade order has been rejected. Check your dashboard for details.',
    channel: 'push',
  },
  DECISION_BLOCKED: {
    title: 'Decision Blocked',
    body: 'An investment decision was blocked by compliance. Review required.',
    channel: 'push',
  },
  WITHDRAWAL_COMPLETED: {
    title: 'Withdrawal Completed',
    body: 'Your withdrawal has been processed successfully.',
    channel: 'email',
  },
```

- [ ] **Step 4: Add event types to EVENT_TYPES array**

In `services/investor/investor-ctrl/src/handlers/event-listener.ts`, add to EVENT_TYPES (line 69-74). Import `AdvisoryCrossDomainEventTypes` is already present:

```typescript
const EVENT_TYPES = [
  InvestorBffEventTypes.ONBOARDING_COMPLETED, InvestorBffEventTypes.MANDATE_GRANTED,
  InvestorBffEventTypes.GOAL_UPDATED, InvestorBffEventTypes.DEPOSIT_INITIATED,
  InvestorBffEventTypes.OPERATING_MODE_CHANGED, AdvisoryCrossDomainEventTypes.DECISION_APPROVED,
  AdvisoryCrossDomainEventTypes.DECISION_BLOCKED,
  ExecutionCrossDomainEventTypes.ORDER_FILLED, ExecutionCrossDomainEventTypes.ORDER_REJECTED,
  ExecutionCrossDomainEventTypes.WITHDRAWAL_COMPLETED,
  LedgerCrossDomainEventTypes.BALANCE_UPDATED,
] as const;
```

- [ ] **Step 5: Add event types to Ingress**

In `services/investor/investor-ctrl/src/service.stack.ts`, add to eventTypes array:

```typescript
    const triggerIngress = new Ingress(this, 'TriggerIngress', {
      eventTypes: [
        'ONBOARDING_COMPLETED',
        'MANDATE_GRANTED',
        'GOAL_UPDATED',
        'DEPOSIT_INITIATED',
        'OPERATING_MODE_CHANGED',
        'DECISION_APPROVED',
        'DECISION_BLOCKED',
        'ORDER_FILLED',
        'ORDER_REJECTED',
        'WITHDRAWAL_COMPLETED',
        'BALANCE_UPDATED',
      ],
    });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm nx test investor-ctrl`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-ctrl/src/ services/investor/investor-ctrl/test/
git commit -m "fix(investor-ctrl): add notifications for ORDER_REJECTED, DECISION_BLOCKED, WITHDRAWAL_COMPLETED"
```

---

## Wave 3: Staged Order Lifecycle

### Task 6: Create staged-order-processor (S1)

**Context:** execution-ctrl creates `StagedOrder` records when market is closed. The `OrderRepository` has `getStagedOrders(tenantId)` and `deleteStagedOrder(tenantId, orderId)` methods but nothing calls them. A scheduled Lambda should query staged orders at market open, run safety checks, and submit them.

**Design:** An EventBridge Schedule fires at US market open (9:30 AM ET, weekdays). The handler queries ALL tenants' staged orders (via a scan or GSI), runs safety checks for each, and writes `Order` records with status `SUBMITTED`, then deletes the `StagedOrder` record. The execution-ctrl CDC then publishes `ORDER_SUBMITTED`.

**Files:**
- Create: `services/execution/execution-ctrl/src/handlers/staged-order-processor.ts`
- Modify: `services/execution/execution-ctrl/src/service.stack.ts`
- Create: `services/execution/execution-ctrl/test/staged-order-processor.test.ts`

- [ ] **Step 1: Write failing test for staged order processor**

Create `services/execution/execution-ctrl/test/staged-order-processor.test.ts`:

```typescript
import { OrderRepository } from '../src/repositories/order.repository';
import { SafetyChecksService } from '../src/services/safety-checks.service';
import { processStagedOrders, type StagedOrderProcessorDeps } from '../src/handlers/staged-order-processor';

describe('staged-order-processor', () => {
  const mockRepository = {
    getStagedOrders: jest.fn(),
    deleteStagedOrder: jest.fn(),
  } as unknown as OrderRepository;

  const mockSafetyChecks = {
    runAllChecks: jest.fn(),
  } as unknown as SafetyChecksService;

  const deps: StagedOrderProcessorDeps = {
    repository: mockRepository,
    safetyChecks: mockSafetyChecks,
  };

  beforeEach(() => jest.clearAllMocks());

  it('should submit staged orders and delete StagedOrder records', async () => {
    (mockRepository.getStagedOrders as jest.Mock).mockResolvedValue([
      { tenantId: 't1', orderId: 'o1', proposedTrades: [{ symbol: 'AAPL', side: 'BUY', quantity: 10 }] },
    ]);
    (mockSafetyChecks.runAllChecks as jest.Mock).mockResolvedValue({ passed: true });

    const result = await processStagedOrders(deps);

    expect(result.submitted).toBe(1);
    expect(result.rejected).toBe(0);
    expect(mockRepository.deleteStagedOrder).toHaveBeenCalledWith('t1', 'o1');
  });

  it('should reject staged orders that fail safety checks', async () => {
    (mockRepository.getStagedOrders as jest.Mock).mockResolvedValue([
      { tenantId: 't1', orderId: 'o2', proposedTrades: [] },
    ]);
    (mockSafetyChecks.runAllChecks as jest.Mock).mockResolvedValue({ passed: false, reason: 'drift' });

    const result = await processStagedOrders(deps);

    expect(result.submitted).toBe(0);
    expect(result.rejected).toBe(1);
    expect(mockRepository.deleteStagedOrder).toHaveBeenCalledWith('t1', 'o2');
  });

  it('should handle no staged orders gracefully', async () => {
    (mockRepository.getStagedOrders as jest.Mock).mockResolvedValue([]);

    const result = await processStagedOrders(deps);

    expect(result.submitted).toBe(0);
    expect(result.rejected).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test execution-ctrl --testPathPattern=staged-order-processor`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement staged-order-processor handler**

Create `services/execution/execution-ctrl/src/handlers/staged-order-processor.ts`:

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger, requireEnv, getTime } from '@nestfolio/event-processor';
import { OrderRepository } from '../repositories/order.repository';
import { SafetyChecksService } from '../services/safety-checks.service';
import type { ProposedTrade } from '@nestfolio/advisory-adpt/domain';

export interface StagedOrderProcessorDeps {
  readonly repository: OrderRepository;
  readonly safetyChecks: SafetyChecksService;
}

export async function processStagedOrders(
  deps: StagedOrderProcessorDeps,
): Promise<{ submitted: number; rejected: number }> {
  // Query all staged orders across tenants via GSI
  const stagedOrders = await deps.repository.getStagedOrders('*');
  let submitted = 0;
  let rejected = 0;

  for (const staged of stagedOrders) {
    const tenantId = staged['tenantId'] as string;
    const orderId = staged['orderId'] as string;
    const proposedTrades = (staged['proposedTrades'] ?? []) as ProposedTrade[];
    const now = getTime();

    const safetyResult = await deps.safetyChecks.runAllChecks(tenantId, proposedTrades);

    if (safetyResult.passed) {
      logger.info('Submitting staged order', { tenantId, orderId });
      // Write Order with status=SUBMITTED — CDC will publish ORDER_SUBMITTED
      await deps.repository.putOrder({
        __typename: 'Order',
        tenantId,
        orderId,
        proposedTrades,
        status: 'SUBMITTED',
        sourceEventId: `staged-${orderId}`,
        createdAt: now,
        updatedAt: now,
        timestamp: now,
      });
      submitted++;
    } else {
      logger.info('Rejecting staged order', { tenantId, orderId, reason: safetyResult.reason });
      await deps.repository.putOrder({
        __typename: 'Order',
        tenantId,
        orderId,
        proposedTrades,
        status: 'REJECTED',
        reason: safetyResult.reason,
        sourceEventId: `staged-${orderId}`,
        createdAt: now,
        updatedAt: now,
        timestamp: now,
      });
      rejected++;
    }

    await deps.repository.deleteStagedOrder(tenantId, orderId);
  }

  logger.info('Staged order processing complete', { submitted, rejected, total: stagedOrders.length });
  return { submitted, rejected };
}

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new OrderRepository(TABLE_NAME, dynamoClient);
const safetyChecks = new SafetyChecksService(repository);

export const handler = async () => processStagedOrders({ repository, safetyChecks });
```

**Important:** The existing `getStagedOrders(tenantId)` method queries by exact tenantId via GSI. For the scheduled processor, a new `getAllStagedOrders()` method is needed in `OrderRepository` that performs a DDB Scan filtered by `__typename = 'StagedOrder'`. Add this method to `services/execution/execution-ctrl/src/repositories/order.repository.ts` before implementing the processor.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test execution-ctrl --testPathPattern=staged-order-processor`
Expected: PASS

- [ ] **Step 5: Add EventBridge Schedule to service stack**

Modify `services/execution/execution-ctrl/src/service.stack.ts`. Add an EventBridge Schedule rule for US market open (9:30 AM ET, weekdays). This requires importing `aws-events` constructs:

```typescript
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

// Inside constructor, after egress:
const stagedOrderProcessor = new NodejsFunction(this, 'StagedOrderProcessor', {
  entry: path.join(__dirname, 'handlers/staged-order-processor.ts'),
  runtime: Runtime.NODEJS_20_X,
  environment: { TABLE_NAME: this.stateTable.tableName },
  timeout: Duration.minutes(5),
});
this.stateTable.grantReadWriteData(stagedOrderProcessor);

new Rule(this, 'MarketOpenSchedule', {
  schedule: Schedule.cron({ minute: '30', hour: '14', weekDay: 'MON-FRI' }), // 9:30 AM ET = 14:30 UTC
  targets: [new LambdaFunction(stagedOrderProcessor)],
});
```

- [ ] **Step 6: Run build to verify stack compiles**

Run: `pnpm nx build execution-ctrl`
Expected: BUILD SUCCESS

- [ ] **Step 7: Commit**

```bash
git add services/execution/execution-ctrl/src/handlers/staged-order-processor.ts services/execution/execution-ctrl/src/service.stack.ts services/execution/execution-ctrl/test/staged-order-processor.test.ts
git commit -m "feat(execution-ctrl): add scheduled staged-order processor for market open"
```

---

## Wave 4: Documentation Fixes

### Task 7: Update data-flow documentation

**Files:**
- Modify: `docs/data-flows/08-order-execution.md`
- Modify: `docs/data-flows/09-order-ledger.md`
- Modify: `docs/data-flows/13-portfolio-rebalancing.md`

- [ ] **Step 1: Fix 08-order-execution.md**

Update step 4 in the summary table to reflect the CDC function-based mapping:

```
| 4 | broker-adpt | Execution | ORDER_SUBMITTED | Simulation engine processes trade; emits DEPOSIT_DETECTED / WITHDRAWAL_COMPLETED via CDC | ORDER_FILLED (CDC) | ExecutionBus |
```

- [ ] **Step 2: Fix 09-order-ledger.md**

Revert the C3 false-alarm edit. Step 4 should read:

```
| 4 | ledger-ctrl | Ledger | Reducer output | Store daily Account snapshot | BALANCE_UPDATED / PORTFOLIO_UPDATED (CDC via customEventTypeMap) | LedgerBus |
```

- [ ] **Step 3: Fix 13-portfolio-rebalancing.md**

Update step 8 to reflect broker-adpt is simulation engine, not real broker:

```
| 8 | broker-adpt | Execution | ORDER_SUBMITTED | Simulation engine processes trades via CDC | ORDER_FILLED (per trade) | ExecutionBus |
```

- [ ] **Step 4: Commit**

```bash
git add docs/data-flows/
git commit -m "docs: update data-flow diagrams for CDC fixes and verified patterns"
```

---

## Verification Checkpoint

After all waves, run the full test suite:

```bash
pnpm nx run-many --target=test --all
```

Expected: ALL projects PASS. Current baseline: 31 projects passing.
