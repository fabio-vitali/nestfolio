# Eliminate ledger-core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `libs/ledger-core` by moving domain logic to `ledger-ctrl` and replacing BFF event replay with pre-computed snapshot queries.

**Architecture:** `ledger-ctrl` absorbs the accountReducer, commands, and state types. It writes snapshot history entries inside its existing DDB transaction. Events are enriched with snapshot data. `ledger-bff` pipes store snapshot-at entries; time-travel becomes a single DDB query.

**Tech Stack:** TypeScript, DynamoDB, AWS CDK, Jest

**Spec:** `docs/superpowers/specs/2026-03-21-eliminate-ledger-core-design.md`

---

## File Map

### ledger-ctrl — new/modified files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `services/ledger/ledger-ctrl/src/domain/account-state.ts` | AccountState, PositionState, INITIAL_ACCOUNT_STATE |
| Create | `services/ledger/ledger-ctrl/src/domain/account.reducer.ts` | accountReducer (same code, import from local) |
| Create | `services/ledger/ledger-ctrl/src/domain/record-fill.ts` | RecordFill command |
| Create | `services/ledger/ledger-ctrl/src/domain/record-deposit.ts` | RecordDeposit command |
| Create | `services/ledger/ledger-ctrl/src/domain/record-withdrawal.ts` | RecordWithdrawal command |
| Create | `services/ledger/ledger-ctrl/src/domain/record-corporate-action.ts` | RecordCorporateAction command |
| Create | `services/ledger/ledger-ctrl/src/domain/submit-order.ts` | SubmitOrder command |
| Create | `services/ledger/ledger-ctrl/src/domain/cancel-order.ts` | CancelOrder command |
| Modify | `services/ledger/ledger-ctrl/src/domain/index.ts` | Add exports for new domain files |
| Modify | `services/ledger/ledger-ctrl/src/handlers/reducer.ts:14` | Import from `../domain/` instead of `@nestfolio/ledger-core` |
| Modify | `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts:90-183` | Add SnapshotHistory item to saveSnapshotWithEvents transaction |
| Modify | `services/ledger/ledger-ctrl/src/service.stack.ts:36-38` | Add SNAPSHOT_HISTORY_TTL_DAYS env var |

### ledger-ctrl — test files (move from ledger-core)

| Action | Path | Purpose |
|--------|------|---------|
| Create | `services/ledger/ledger-ctrl/test/domain/account-state.test.ts` | From `libs/ledger-core/test/account-state.test.ts` |
| Create | `services/ledger/ledger-ctrl/test/domain/account.reducer.test.ts` | From `libs/ledger-core/test/account.reducer.test.ts` |
| Create | `services/ledger/ledger-ctrl/test/domain/record-fill.test.ts` | From `libs/ledger-core/test/record-fill.test.ts` |
| Create | `services/ledger/ledger-ctrl/test/domain/record-deposit.test.ts` | From `libs/ledger-core/test/record-deposit.test.ts` |
| Create | `services/ledger/ledger-ctrl/test/domain/record-withdrawal.test.ts` | From `libs/ledger-core/test/record-withdrawal.test.ts` |
| Create | `services/ledger/ledger-ctrl/test/domain/record-corporate-action.test.ts` | From `libs/ledger-core/test/record-corporate-action.test.ts` |
| Create | `services/ledger/ledger-ctrl/test/domain/submit-order.test.ts` | From `libs/ledger-core/test/submit-order.test.ts` |
| Create | `services/ledger/ledger-ctrl/test/domain/cancel-order.test.ts` | From `libs/ledger-core/test/cancel-order.test.ts` |

### ledger-bff — modified files

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `services/ledger/ledger-bff/src/services/time-travel.service.ts` | Rewrite: DDB query instead of event replay |
| Modify | `services/ledger/ledger-bff/src/handlers/graphql-resolver.ts:14,69-70` | Inline default cash balance, drop ledger-core import |
| Modify | `services/ledger/ledger-bff/src/repositories/portfolio.repository.ts` | Add `saveSnapshotAt` and `getSnapshotAt` methods |
| Modify | `services/ledger/ledger-bff/src/pipes/balance-updated.pipe.ts` | Also call `saveSnapshotAt` from enriched snapshot payload |
| Modify | `services/ledger/ledger-bff/src/pipes/portfolio-updated.pipe.ts` | Also call `saveSnapshotAt` from enriched snapshot payload |
| Modify | `services/ledger/ledger-bff/src/service.stack.ts:29-32` | Add SNAPSHOT_HISTORY_TTL_DAYS env var |

### ledger-bff — test modifications

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `services/ledger/ledger-bff/test/handlers/graphql-resolver.test.ts:77-88` | Remove ledger-core + command-core mocks, update time-travel assertions |

### Cleanup — deletions and config changes

| Action | Path | Purpose |
|--------|------|---------|
| Delete | `libs/ledger-core/` | Entire library directory |
| Modify | `tsconfig.base.json:34-35` | Remove `@nestfolio/ledger-core` path aliases |
| Modify | `services/ledger/ledger-ctrl/jest.config.js:15-16` | Remove ledger-core moduleNameMapper entries |
| Modify | `services/ledger/ledger-bff/jest.config.js:13-15` | Remove ledger-core + command-core moduleNameMapper entries |
| Modify | `services/investor/dashboard-bff/jest.config.js:7` | Remove ledger-core moduleNameMapper entry |
| Modify | `services/ledger/ledger-ctrl/test/handlers/event-listener.test.ts:85-92` | Remove ledger-core mock |
| Modify | `services/ledger/ledger-ctrl/test/handlers/reducer.test.ts` | No changes needed (doesn't mock ledger-core, imports createReducer) |

---

## Chunk 1: Move domain files to ledger-ctrl (Tasks 1-2)

### Task 1: Move source files from ledger-core to ledger-ctrl/src/domain

**Files:**
- Create: `services/ledger/ledger-ctrl/src/domain/account-state.ts`
- Create: `services/ledger/ledger-ctrl/src/domain/account.reducer.ts`
- Create: `services/ledger/ledger-ctrl/src/domain/record-fill.ts`
- Create: `services/ledger/ledger-ctrl/src/domain/record-deposit.ts`
- Create: `services/ledger/ledger-ctrl/src/domain/record-withdrawal.ts`
- Create: `services/ledger/ledger-ctrl/src/domain/record-corporate-action.ts`
- Create: `services/ledger/ledger-ctrl/src/domain/submit-order.ts`
- Create: `services/ledger/ledger-ctrl/src/domain/cancel-order.ts`
- Modify: `services/ledger/ledger-ctrl/src/domain/index.ts`

- [ ] **Step 1: Copy all source files from `libs/ledger-core/src/` to `services/ledger/ledger-ctrl/src/domain/`**

Copy these 8 files (NOT `index.ts` — we'll update the existing barrel):
```bash
cp libs/ledger-core/src/account-state.ts services/ledger/ledger-ctrl/src/domain/
cp libs/ledger-core/src/account.reducer.ts services/ledger/ledger-ctrl/src/domain/
cp libs/ledger-core/src/record-fill.ts services/ledger/ledger-ctrl/src/domain/
cp libs/ledger-core/src/record-deposit.ts services/ledger/ledger-ctrl/src/domain/
cp libs/ledger-core/src/record-withdrawal.ts services/ledger/ledger-ctrl/src/domain/
cp libs/ledger-core/src/record-corporate-action.ts services/ledger/ledger-ctrl/src/domain/
cp libs/ledger-core/src/submit-order.ts services/ledger/ledger-ctrl/src/domain/
cp libs/ledger-core/src/cancel-order.ts services/ledger/ledger-ctrl/src/domain/
```

The files are self-contained — their internal imports reference each other via relative paths (e.g., `./account-state`). The only external import is `@nestfolio/command-core` in `account.reducer.ts`, which stays unchanged (ledger-ctrl already depends on command-core).

- [ ] **Step 2: Update `services/ledger/ledger-ctrl/src/domain/index.ts`**

Add exports for all new domain files. Currently it only exports events:

```ts
export { LedgerCtrlEventTypes } from './events';
export type { LedgerCtrlEventType } from './events';

// Account state
export {
  type PositionState,
  type AccountState,
  INITIAL_ACCOUNT_STATE,
} from './account-state';

// Ledger domain commands
export {
  RecordFill,
  RecordFillSchema,
  type RecordFillPayload,
} from './record-fill';

export {
  RecordDeposit,
  RecordDepositSchema,
  type RecordDepositPayload,
} from './record-deposit';

export {
  RecordWithdrawal,
  RecordWithdrawalSchema,
  type RecordWithdrawalPayload,
} from './record-withdrawal';

export {
  RecordCorporateAction,
  RecordCorporateActionSchema,
  type RecordCorporateActionPayload,
} from './record-corporate-action';

export {
  SubmitOrder,
  SubmitOrderSchema,
  type SubmitOrderPayload,
} from './submit-order';

export {
  CancelOrder,
  CancelOrderSchema,
  type CancelOrderPayload,
} from './cancel-order';

// Reducer
export { accountReducer } from './account.reducer';
```

- [ ] **Step 3: Update `services/ledger/ledger-ctrl/src/handlers/reducer.ts` import**

Change line 14 from:
```ts
import { INITIAL_ACCOUNT_STATE, type AccountState, accountReducer } from '@nestfolio/ledger-core';
```
to:
```ts
import { INITIAL_ACCOUNT_STATE, type AccountState, accountReducer } from '../domain';
```

- [ ] **Step 4: Run ledger-ctrl tests to verify nothing broke**

```bash
pnpm nx test ledger-ctrl
```
Expected: All 7 existing tests pass. The domain files are now local, the reducer imports from `../domain`.

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-ctrl/src/domain/ services/ledger/ledger-ctrl/src/handlers/reducer.ts
git commit -m "refactor: move ledger-core domain files to ledger-ctrl/src/domain"
```

### Task 2: Move test files from ledger-core to ledger-ctrl/test/domain

**Files:**
- Create: `services/ledger/ledger-ctrl/test/domain/account-state.test.ts`
- Create: `services/ledger/ledger-ctrl/test/domain/account.reducer.test.ts`
- Create: `services/ledger/ledger-ctrl/test/domain/record-fill.test.ts`
- Create: `services/ledger/ledger-ctrl/test/domain/record-deposit.test.ts`
- Create: `services/ledger/ledger-ctrl/test/domain/record-withdrawal.test.ts`
- Create: `services/ledger/ledger-ctrl/test/domain/record-corporate-action.test.ts`
- Create: `services/ledger/ledger-ctrl/test/domain/submit-order.test.ts`
- Create: `services/ledger/ledger-ctrl/test/domain/cancel-order.test.ts`

- [ ] **Step 1: Copy all test files**

```bash
mkdir -p services/ledger/ledger-ctrl/test/domain
cp libs/ledger-core/test/*.test.ts services/ledger/ledger-ctrl/test/domain/
```

- [ ] **Step 2: Update import paths in copied test files**

Each test file imports from `../src/<module>`. Update them to reference the new location. For example, in `account.reducer.test.ts`, change:
```ts
import { accountReducer } from '../src/account.reducer';
```
to:
```ts
import { accountReducer } from '../../src/domain/account.reducer';
```

Apply this pattern to all 8 test files — every `../src/` becomes `../../src/domain/`.

- [ ] **Step 3: Run the moved tests**

```bash
pnpm nx test ledger-ctrl
```
Expected: All tests pass (original 7 + 8 new domain tests = 15+ tests).

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-ctrl/test/domain/
git commit -m "test: move ledger-core tests to ledger-ctrl/test/domain"
```

---

## Chunk 2: Snapshot history in ledger-ctrl (Tasks 3-4)

### Task 3: Add SnapshotHistory to ledger-ctrl transaction

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts:90-183`
- Modify: `services/ledger/ledger-ctrl/src/handlers/reducer.ts`
- Modify: `services/ledger/ledger-ctrl/src/service.stack.ts:36-38`

- [ ] **Step 1: Write failing test — snapshot history item in transaction**

Add a test to `services/ledger/ledger-ctrl/test/handlers/reducer.test.ts`:

```ts
it('should include SnapshotHistory item in the transaction', async () => {
  mockSend
    .mockResolvedValueOnce({ Items: [] }) // getLatestSnapshot
    .mockResolvedValueOnce({
      Items: [{
        eventId: 'evt-1',
        eventType: 'DEPOSIT_DETECTED',
        payload: { depositId: 'd1', amountCents: 500000, depositedAt: '2025-01-01T00:00:00.000Z' },
        timestamp: '2025-01-01T00:00:00.000Z',
        sequenceNo: 1,
        streamType: 'actual',
      }],
    }) // queryEntriesSince
    .mockResolvedValue({}); // transactWrite + checkpoint

  const event = buildStreamEvent([{
    eventType: 'DEPOSIT_DETECTED',
    tenantId: 't1',
    streamType: 'actual',
    sequenceNo: 1,
    payload: { depositId: 'd1', amountCents: 500000, depositedAt: '2025-01-01T00:00:00.000Z' },
  }]);

  await reducer(event);

  const txCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'TransactWrite');
  expect(txCalls).toHaveLength(1);
  const transactItems = txCalls[0][0].input.TransactItems;

  // Find the SnapshotHistory item
  const snapshotHistory = transactItems.find(
    (t: any) => t.Put.Item.__typename === 'SnapshotHistory',
  );
  expect(snapshotHistory).toBeDefined();
  expect(snapshotHistory.Put.Item.pk).toBe('Account#t1#actual');
  expect(snapshotHistory.Put.Item.sk).toMatch(/^SnapshotAt#/);
  expect(snapshotHistory.Put.Item.cashBalanceCents).toBeDefined();
  expect(snapshotHistory.Put.Item.positions).toBeDefined();
  expect(snapshotHistory.Put.Item.lastEventSequence).toBe(1);
  expect(snapshotHistory.Put.Item.ttl).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test ledger-ctrl -- --testPathPattern="reducer.test"
```
Expected: FAIL — no SnapshotHistory item in transaction.

- [ ] **Step 3: Add SnapshotHistory to `saveSnapshotWithEvents`**

In `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts`, modify the `saveSnapshotWithEvents` method. Add a `ttlDays` parameter to the `SnapshotWithEvents` interface and add a SnapshotHistory `Put` item to the `transactItems` array.

Add to the `SnapshotWithEvents` interface:
```ts
readonly ttlDays: number;
```

Add this item to the `transactItems` array (after the LedgerEntryEvent item, before `await this.transactWrite`):
```ts
// SnapshotHistory — append-only, TTL-bounded
transactItems.push({
  Put: {
    TableName: this.tableName,
    Item: {
      pk,
      sk: `SnapshotAt#${now}`,
      __typename: 'SnapshotHistory',
      tenantId: data.tenantId,
      streamType: data.streamType,
      timestamp: now,
      positions: (data.state as any).positions ?? {},
      cashBalanceCents: (data.state as any).cashBalanceCents ?? 0,
      lastEventSequence: data.lastEventSequence,
      ttl: Math.floor(Date.now() / 1000) + (data.ttlDays * 86400),
    },
  },
});
```

- [ ] **Step 4: Pass `ttlDays` from reducer**

In `services/ledger/ledger-ctrl/src/handlers/reducer.ts`, add `ttlDays` to the `saveSnapshotWithEvents` call:

Add at the top (near other `requireEnv` calls):
```ts
const SNAPSHOT_TTL_DAYS = Number(process.env['SNAPSHOT_HISTORY_TTL_DAYS'] ?? '365');
```

In the `saveSnapshotWithEvents` call, add the field:
```ts
await deps.repository.saveSnapshotWithEvents({
  tenantId: group.tenantId,
  streamType: group.streamType,
  state: nextState as unknown as Record<string, unknown>,
  lastEventSequence: maxSeq,
  version: newVersion,
  balanceChanged,
  positionsChanged,
  userId,
  ttlDays: SNAPSHOT_TTL_DAYS,
});
```

- [ ] **Step 5: Add env var to service stack**

In `services/ledger/ledger-ctrl/src/service.stack.ts`, add `SNAPSHOT_HISTORY_TTL_DAYS` to the reducer Lambda's environment block (line 37):

```ts
environment: {
  TABLE_NAME: this.state.getTable().tableName,
  SERVICE_NAME: 'ledger-ctrl',
  SNAPSHOT_HISTORY_TTL_DAYS: '365',
},
```

- [ ] **Step 6: Run tests**

```bash
pnpm nx test ledger-ctrl -- --testPathPattern="reducer.test"
```
Expected: All pass, including the new SnapshotHistory assertion.

- [ ] **Step 7: Commit**

```bash
git add services/ledger/ledger-ctrl/src/ services/ledger/ledger-ctrl/test/
git commit -m "feat: add SnapshotHistory item to ledger-ctrl transaction"
```

### Task 4: Enrich published events with snapshot data

The event-publisher uses `changeDataCapture` which publishes DDB Stream items as events. The SnapshotHistory items (written via the same transaction) will be picked up by the existing DDB Stream → event-publisher flow. However, the event-publisher only processes `BalanceEvent`, `PortfolioEvent`, and `LedgerEntryEvent` typenames — `SnapshotHistory` is NOT in the event type map, so it won't be published as a separate event.

Instead, enrich the existing `BalanceEvent` and `PortfolioEvent` items (already written to the transaction) with the full snapshot data. This way, when the CDC publishes BALANCE_UPDATED/PORTFOLIO_UPDATED events, they already contain the snapshot.

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts:120-160`

- [ ] **Step 1: Write failing test — snapshot data in BalanceEvent/PortfolioEvent items**

Add a test to `services/ledger/ledger-ctrl/test/handlers/reducer.test.ts`:

```ts
it('should include snapshot data in BalanceEvent and PortfolioEvent items', async () => {
  mockSend
    .mockResolvedValueOnce({ Items: [] }) // getLatestSnapshot
    .mockResolvedValueOnce({
      Items: [{
        eventId: 'evt-1',
        eventType: 'ORDER_FILLED',
        payload: { orderId: 'o1', symbol: 'VTI', side: 'BUY', quantity: 10, fillPrice: 245.50, filledAt: '2025-01-01T00:00:00.000Z' },
        timestamp: '2025-01-01T00:00:00.000Z',
        sequenceNo: 1,
        streamType: 'actual',
      }],
    }) // queryEntriesSince
    .mockResolvedValue({}); // transactWrite + checkpoint

  const event = buildStreamEvent([{
    eventType: 'ORDER_FILLED',
    tenantId: 't1',
    streamType: 'actual',
    sequenceNo: 1,
    payload: { orderId: 'o1', symbol: 'VTI', side: 'BUY', quantity: 10, fillPrice: 245.50, filledAt: '2025-01-01T00:00:00.000Z' },
  }]);

  await reducer(event);

  const txCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'TransactWrite');
  const transactItems = txCalls[0][0].input.TransactItems;

  const balanceItem = transactItems.find(
    (t: any) => t.Put.Item.__typename === 'BalanceEvent',
  );
  expect(balanceItem.Put.Item.snapshot).toBeDefined();
  expect(balanceItem.Put.Item.snapshot.positions).toBeDefined();
  expect(balanceItem.Put.Item.snapshot.cashBalanceCents).toBeDefined();
  expect(balanceItem.Put.Item.snapshot.lastEventSequence).toBe(1);

  const portfolioItem = transactItems.find(
    (t: any) => t.Put.Item.__typename === 'PortfolioEvent',
  );
  expect(portfolioItem.Put.Item.snapshot).toBeDefined();
  expect(portfolioItem.Put.Item.snapshot.positions).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test ledger-ctrl -- --testPathPattern="reducer.test"
```
Expected: FAIL — snapshot field undefined.

- [ ] **Step 3: Add snapshot field to BalanceEvent and PortfolioEvent items**

In `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts`, in the `saveSnapshotWithEvents` method:

Add a `snapshot` object before the transactItems array:
```ts
const snapshot = {
  positions: (data.state as any).positions ?? {},
  cashBalanceCents: (data.state as any).cashBalanceCents ?? 0,
  lastEventSequence: data.lastEventSequence,
};
```

Then add `snapshot` to both the BalanceEvent and PortfolioEvent items:

In the BalanceEvent `Put.Item` (around line 130), add:
```ts
snapshot,
```

In the PortfolioEvent `Put.Item` (around line 150), add:
```ts
snapshot,
```

Also add `snapshot` to the LedgerEntryEvent `Put.Item` (for simulated stream, the BFF pipe needs it):
```ts
snapshot,
```

- [ ] **Step 4: Run tests**

```bash
pnpm nx test ledger-ctrl -- --testPathPattern="reducer.test"
```
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts services/ledger/ledger-ctrl/test/
git commit -m "feat: enrich BalanceEvent/PortfolioEvent with snapshot data"
```

---

## Chunk 3: ledger-bff snapshot-at storage (Tasks 5-7)

### Task 5: Add saveSnapshotAt and getSnapshotAt to BFF repository

**Files:**
- Modify: `services/ledger/ledger-bff/src/repositories/portfolio.repository.ts`
- Test: `services/ledger/ledger-bff/test/repositories/portfolio.repository.test.ts`

- [ ] **Step 1: Write failing tests for saveSnapshotAt and getSnapshotAt**

Add tests to `services/ledger/ledger-bff/test/repositories/portfolio.repository.test.ts`:

```ts
describe('saveSnapshotAt', () => {
  it('should write a SnapshotAt item with TTL', async () => {
    mockSend.mockResolvedValueOnce({}); // put

    await repository.saveSnapshotAt('t1', 'actual', '2025-06-15T12:00:00.000Z', {
      cashBalanceCents: 7_500_000,
      positions: { VTI: { symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 250 } },
    }, 365);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    const putCall = PutCommand.mock.calls[0][0];
    expect(putCall.Item.pk).toBe('SnapshotAt#t1#actual');
    expect(putCall.Item.sk).toBe('2025-06-15T12:00:00.000Z');
    expect(putCall.Item.__typename).toBe('SnapshotAt');
    expect(putCall.Item.cashBalanceCents).toBe(7_500_000);
    expect(putCall.Item.ttl).toBeGreaterThan(0);
  });
});

describe('getSnapshotAt', () => {
  it('should return the most recent snapshot at or before timestamp', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{
        pk: 'SnapshotAt#t1#actual',
        sk: '2025-06-14T23:59:00.000Z',
        cashBalanceCents: 7_500_000,
        positions: {},
      }],
    });

    const result = await repository.getSnapshotAt('t1', '2025-06-15T12:00:00.000Z');
    expect(result).toBeDefined();
    expect(result!['cashBalanceCents']).toBe(7_500_000);

    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
    const queryInput = QueryCommand.mock.calls[0][0];
    expect(queryInput.ExpressionAttributeValues[':pk']).toBe('SnapshotAt#t1#actual');
    expect(queryInput.ScanIndexForward).toBe(false);
    expect(queryInput.Limit).toBe(1);
  });

  it('should return null when no snapshot exists', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await repository.getSnapshotAt('t1', '2025-01-01T00:00:00.000Z');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx test ledger-bff -- --testPathPattern="portfolio.repository.test"
```
Expected: FAIL — `saveSnapshotAt` and `getSnapshotAt` not defined.

- [ ] **Step 3: Implement saveSnapshotAt and getSnapshotAt**

Add to `services/ledger/ledger-bff/src/repositories/portfolio.repository.ts`:

Add `QueryCommand` to the imports from `@aws-sdk/lib-dynamodb` (if not already imported — it is already imported at line 6).

Add these methods to the class:

```ts
readonly saveSnapshotAt = this.log('saveSnapshotAt',
  async (
    tenantId: string,
    streamType: string,
    timestamp: string,
    snapshot: CheckpointState,
    ttlDays: number,
  ): Promise<void> => {
    const ttl = Math.floor(Date.now() / 1000) + (ttlDays * 86400);
    await this.put({
      pk: `SnapshotAt#${tenantId}#${streamType}`,
      sk: timestamp,
      __typename: 'SnapshotAt',
      tenantId,
      streamType,
      timestamp,
      positions: snapshot.positions,
      cashBalanceCents: snapshot.cashBalanceCents,
      ttl,
    });
  },
);

readonly getSnapshotAt = this.log('getSnapshotAt',
  async (tenantId: string, timestamp: string): Promise<Record<string, unknown> | null> => {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND sk <= :ts',
        ExpressionAttributeValues: {
          ':pk': `SnapshotAt#${tenantId}#actual`,
          ':ts': timestamp,
        },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    const items = result.Items ?? [];
    return items.length > 0 ? (items[0] as Record<string, unknown>) : null;
  },
);
```

- [ ] **Step 4: Run tests**

```bash
pnpm nx test ledger-bff -- --testPathPattern="portfolio.repository.test"
```
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-bff/src/repositories/ services/ledger/ledger-bff/test/repositories/
git commit -m "feat: add saveSnapshotAt and getSnapshotAt to portfolio repository"
```

### Task 6: Update BFF pipes to store snapshot-at entries

**Files:**
- Modify: `services/ledger/ledger-bff/src/pipes/balance-updated.pipe.ts`
- Modify: `services/ledger/ledger-bff/src/pipes/portfolio-updated.pipe.ts`
- Modify: `services/ledger/ledger-bff/src/service.stack.ts`

- [ ] **Step 1: Write failing tests for pipes storing snapshot-at**

Add tests to `services/ledger/ledger-bff/test/handlers/event-listener.test.ts`. If the test file mocks `@nestfolio/ledger-core`, note that we'll fix those mocks in a later task — for now just add the new assertion:

```ts
it('should store snapshot-at on BALANCE_UPDATED when snapshot data is present', async () => {
  // ... set up event with snapshot field in payload
  // ... verify saveSnapshotAt was called
});

it('should store snapshot-at on PORTFOLIO_UPDATED when snapshot data is present', async () => {
  // ... similar
});
```

The exact test structure depends on the existing test harness. Write tests that verify `saveSnapshotAt` is called when the event payload contains a `snapshot` field.

- [ ] **Step 2: Update BalanceUpdatedPipe**

In `services/ledger/ledger-bff/src/pipes/balance-updated.pipe.ts`:

1. Add `PositionRecord` to the import from the repository (line 2 — currently only imports `PortfolioRepository`).
2. Extend the `BalancePayload` type to include the optional snapshot field.
3. After the existing `upsertBalance` call, add the snapshot storage logic.

The full updated file should look like:

```ts
import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/event-processor';
import { PortfolioRepository, type PositionRecord } from '../repositories/portfolio.repository';

type BalancePayload = {
  cashBalanceCents: number;
  deltaCents: number;
  streamType?: string;
  snapshot?: {
    positions: Record<string, PositionRecord>;
    cashBalanceCents: number;
    lastEventSequence: number;
  };
};

export class BalanceUpdatedPipe
  implements Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>>
{
  constructor(private readonly repository: PortfolioRepository) {}

  async process(uow: UnitOfWork<BusEvent<Record<string, unknown>>>): Promise<void> {
    const { event } = uow;
    const tenantId = (event.context as Record<string, string>).tenantId;
    const payload = event.subject as BalancePayload & Record<string, unknown>;

    const balanceCents = payload.cashBalanceCents ?? 0;
    const deltaCents = payload.deltaCents ?? 0;

    await this.repository.upsertBalance(tenantId, balanceCents, deltaCents);

    // Store snapshot-at for time-travel queries
    if (payload.snapshot) {
      const ttlDays = Number(process.env['SNAPSHOT_HISTORY_TTL_DAYS'] ?? '365');
      const streamType = payload.streamType ?? 'actual';
      await this.repository.saveSnapshotAt(tenantId, streamType, event.timestamp, {
        cashBalanceCents: payload.snapshot.cashBalanceCents,
        positions: payload.snapshot.positions,
      }, ttlDays);
    }

    logger.info('Updated balance projection', {
      tenantId,
      eventType: event.type,
      balanceCents,
    });
  }
}
```

- [ ] **Step 3: Update PortfolioUpdatedPipe**

In `services/ledger/ledger-bff/src/pipes/portfolio-updated.pipe.ts`:

1. Extend the `PortfolioPayload` type to include the optional snapshot field.
2. After the position upsert loop, add the snapshot storage logic.

The full updated file should look like:

```ts
import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/event-processor';
import { PortfolioRepository, type PositionRecord } from '../repositories/portfolio.repository';

type PortfolioPayload = {
  positions: Record<string, PositionRecord>;
  streamType?: string;
  snapshot?: {
    positions: Record<string, PositionRecord>;
    cashBalanceCents: number;
    lastEventSequence: number;
  };
};

export class PortfolioUpdatedPipe
  implements Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>>
{
  constructor(private readonly repository: PortfolioRepository) {}

  async process(uow: UnitOfWork<BusEvent<Record<string, unknown>>>): Promise<void> {
    const { event } = uow;
    const tenantId = (event.context as Record<string, string>).tenantId;
    const payload = event.subject as PortfolioPayload & Record<string, unknown>;

    const positions = payload.positions ?? {};

    for (const [symbol, position] of Object.entries(positions)) {
      await this.repository.upsertPosition(tenantId, symbol, {
        symbol,
        quantity: position.quantity ?? 0,
        averageCostBasis: position.averageCostBasis ?? 0,
        totalCostBasis: position.totalCostBasis ?? 0,
        lastFillPrice: position.lastFillPrice ?? 0,
      });
    }

    // Store snapshot-at for time-travel queries
    if (payload.snapshot) {
      const ttlDays = Number(process.env['SNAPSHOT_HISTORY_TTL_DAYS'] ?? '365');
      const streamType = payload.streamType ?? 'actual';
      await this.repository.saveSnapshotAt(tenantId, streamType, event.timestamp, {
        cashBalanceCents: payload.snapshot.cashBalanceCents,
        positions: payload.snapshot.positions,
      }, ttlDays);
    }

    logger.info('Updated portfolio positions projection', {
      tenantId,
      eventType: event.type,
      positionCount: Object.keys(positions).length,
    });
  }
}
```

- [ ] **Step 4: Add env var to BFF service stack**

In `services/ledger/ledger-bff/src/service.stack.ts`, add `SNAPSHOT_HISTORY_TTL_DAYS` to the event-listener Lambda's environment. Check if the event listener Lambda is defined in the stack or inherited from `Ingress`. If inherited, the env var must be passed through the Ingress props. If not, add to the Lambda environment:

```ts
SNAPSHOT_HISTORY_TTL_DAYS: '365',
```

- [ ] **Step 5: Run tests**

```bash
pnpm nx test ledger-bff
```
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add services/ledger/ledger-bff/src/pipes/ services/ledger/ledger-bff/src/service.stack.ts services/ledger/ledger-bff/test/
git commit -m "feat: BFF pipes store snapshot-at entries from enriched events"
```

### Task 7: Rewrite TimeTravelService and update resolver

**Files:**
- Modify: `services/ledger/ledger-bff/src/services/time-travel.service.ts`
- Modify: `services/ledger/ledger-bff/src/handlers/graphql-resolver.ts`
- Modify: `services/ledger/ledger-bff/test/handlers/graphql-resolver.test.ts`

- [ ] **Step 1: Write failing test for new TimeTravelService behavior**

Update the `getPortfolioAt` tests in `services/ledger/ledger-bff/test/handlers/graphql-resolver.test.ts`. The current tests mock `getCheckpointBefore` + `getEntriesSince`. The new tests should mock `getSnapshotAt`:

```ts
describe('getPortfolioAt', () => {
  it('should return default state when no snapshot exists', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] }); // getSnapshotAt → empty

    const event = buildEvent('getPortfolioAt', { timestamp: '2025-06-15T00:00:00.000Z' });
    const result = await resolver(event) as Record<string, unknown>;

    expect(result['cashBalanceCents']).toBe(10_000_000);
    expect(result['positions']).toEqual([]);
  });

  it('should return snapshot state when snapshot exists', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{
          pk: 'SnapshotAt#tenant-1#actual',
          sk: '2025-06-14T23:00:00.000Z',
          positions: { VTI: { symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 250 } },
          cashBalanceCents: 7_500_000,
          lastEventSequence: 5,
        }],
      }); // getSnapshotAt

    const event = buildEvent('getPortfolioAt', { timestamp: '2025-06-15T00:00:00.000Z' });
    const result = await resolver(event) as Record<string, unknown>;

    expect(result['cashBalanceCents']).toBe(7_500_000);
    const positions = result['positions'] as Array<Record<string, unknown>>;
    expect(positions).toHaveLength(1);
    expect(positions[0]['symbol']).toBe('VTI');
  });
});
```

- [ ] **Step 2: Rewrite TimeTravelService**

Replace the contents of `services/ledger/ledger-bff/src/services/time-travel.service.ts`. This removes ALL imports from `@nestfolio/ledger-core` and `@nestfolio/command-core` (the old file imported `replayEvents` and `LedgerEntry` from command-core, and `AccountState`, `INITIAL_ACCOUNT_STATE`, `accountReducer` from ledger-core):

```ts
import { PortfolioRepository } from '../repositories/portfolio.repository';

const DEFAULT_CASH_BALANCE_CENTS = 10_000_000;

export class TimeTravelService {
  constructor(private readonly repository: PortfolioRepository) {}

  async getPortfolioAt(
    tenantId: string,
    targetTimestamp: string,
  ): Promise<{ positions: Record<string, unknown>; cashBalanceCents: number; lastEventSequence: number }> {
    const snapshot = await this.repository.getSnapshotAt(tenantId, targetTimestamp);
    if (!snapshot) {
      return { positions: {}, cashBalanceCents: DEFAULT_CASH_BALANCE_CENTS, lastEventSequence: 0 };
    }
    return {
      positions: (snapshot['positions'] as Record<string, unknown>) ?? {},
      cashBalanceCents: (snapshot['cashBalanceCents'] as number) ?? DEFAULT_CASH_BALANCE_CENTS,
      lastEventSequence: (snapshot['lastEventSequence'] as number) ?? 0,
    };
  }
}
```

- [ ] **Step 3: Update graphql-resolver.ts — drop ledger-core import**

In `services/ledger/ledger-bff/src/handlers/graphql-resolver.ts`:

Remove line 14:
```ts
import { INITIAL_ACCOUNT_STATE } from '@nestfolio/ledger-core';
```

Add a constant:
```ts
const DEFAULT_CASH_BALANCE_CENTS = 10_000_000;
```

Replace both uses of `INITIAL_ACCOUNT_STATE.cashBalanceCents` (lines 69-70) with `DEFAULT_CASH_BALANCE_CENTS`.

- [ ] **Step 4: Update test mocks — remove ledger-core and command-core mocks**

In `services/ledger/ledger-bff/test/handlers/graphql-resolver.test.ts`:

Remove lines 77-88 (the `jest.mock('@nestfolio/command-core', ...)` and `jest.mock('@nestfolio/ledger-core', ...)` blocks).

The tests no longer need these mocks since the BFF no longer imports from either library.

- [ ] **Step 5: Run tests**

```bash
pnpm nx test ledger-bff
```
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add services/ledger/ledger-bff/src/ services/ledger/ledger-bff/test/
git commit -m "feat: rewrite TimeTravelService to use snapshot queries, drop ledger-core"
```

---

## Chunk 4: Cleanup (Tasks 8-9)

### Task 8: Remove jest.config moduleNameMapper entries and test mocks

**Files:**
- Modify: `services/ledger/ledger-ctrl/jest.config.js:15-16`
- Modify: `services/ledger/ledger-bff/jest.config.js:13-15`
- Modify: `services/investor/dashboard-bff/jest.config.js:7`
- Modify: `services/ledger/ledger-ctrl/test/handlers/event-listener.test.ts:85-92`

- [ ] **Step 1: Remove ledger-core moduleNameMapper from ledger-ctrl jest.config.js**

Remove these two lines (15-16):
```js
'^@nestfolio/ledger-core$': '<rootDir>/../../../libs/ledger-core/src/index.ts',
'^@nestfolio/ledger-core/(.*)$': '<rootDir>/../../../libs/ledger-core/src/$1',
```

- [ ] **Step 2: Remove ledger-core and command-core moduleNameMapper from ledger-bff jest.config.js**

After Task 7, `ledger-bff` has zero imports from `@nestfolio/command-core` (was only used by `time-travel.service.ts`, now rewritten) and zero from `@nestfolio/ledger-core`. Verify first:
```bash
grep -r "@nestfolio/command-core\|@nestfolio/ledger-core" services/ledger/ledger-bff/src/
```
Expected: no results.

Then remove these lines from `services/ledger/ledger-bff/jest.config.js`:
```js
'^@nestfolio/command-core$': '<rootDir>/../../../libs/command-core/src/index.ts',
'^@nestfolio/ledger-core$': '<rootDir>/../../../libs/ledger-core/src/index.ts',
'^@nestfolio/ledger-core/(.*)$': '<rootDir>/../../../libs/ledger-core/src/$1',
```

- [ ] **Step 3: Remove ledger-core moduleNameMapper from dashboard-bff jest.config.js**

Remove line 7:
```js
'^@nestfolio/ledger-core$': '<rootDir>/../../../libs/ledger-core/src/index.ts',
```

- [ ] **Step 4: Remove ledger-core mock from ledger-ctrl event-listener test**

In `services/ledger/ledger-ctrl/test/handlers/event-listener.test.ts`, remove lines 85-92:
```ts
jest.mock('@nestfolio/ledger-core', () => ({
  INITIAL_ACCOUNT_STATE: {
    positions: {},
    cashBalanceCents: 10_000_000,
    lastEventSequence: 0,
  },
  accountReducer: jest.fn((state) => state),
}));
```

Also remove line 84 if it's the `jest.mock('@nestfolio/command-core', ...)` that's only there because ledger-core needed it.

- [ ] **Step 5: Run all affected tests**

```bash
pnpm nx test ledger-ctrl && pnpm nx test ledger-bff && pnpm nx test dashboard-bff
```
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add services/ledger/ledger-ctrl/jest.config.js services/ledger/ledger-bff/jest.config.js services/investor/dashboard-bff/jest.config.js services/ledger/ledger-ctrl/test/
git commit -m "chore: remove ledger-core jest moduleNameMapper and test mocks"
```

### Task 9: Delete ledger-core lib and tsconfig paths

**Files:**
- Delete: `libs/ledger-core/` (entire directory)
- Modify: `tsconfig.base.json:34-35`

- [ ] **Step 1: Verify no remaining imports of ledger-core**

```bash
grep -r "@nestfolio/ledger-core" --include="*.ts" --include="*.js" --include="*.json" .
```
Expected: Only hits in `libs/ledger-core/` itself and `tsconfig.base.json`. No source/test files should reference it.

- [ ] **Step 2: Remove tsconfig.base.json path aliases**

Remove these two lines (34-35):
```json
"@nestfolio/ledger-core": ["libs/ledger-core/src/index.ts"],
"@nestfolio/ledger-core/*": ["libs/ledger-core/src/*"],
```

- [ ] **Step 3: Delete libs/ledger-core/**

```bash
rm -rf libs/ledger-core
```

- [ ] **Step 4: Run full workspace tests**

```bash
pnpm nx run-many -t test --all
```
Expected: All projects pass. No dangling references to ledger-core.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete libs/ledger-core, remove tsconfig path aliases"
```
