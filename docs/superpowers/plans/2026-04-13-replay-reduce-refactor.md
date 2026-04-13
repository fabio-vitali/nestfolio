# Replay-and-Reduce Refactor + Ledger-Ctrl Snapshot CDC Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `replayAndReduce` the single reusable event-sourcing primitive, migrate ledger-ctrl to consume it, then extract derived-event emission from the reducer into a CDC pipeline handler.

**Architecture:** Three-phase refactor. Phase A: fix `replayAndReduce` (remove FilterExpression, add RequestContext support, require `queryEvents`), then migrate ledger-ctrl's `reducer.ts` from raw `EgestionEngine` to a `replayAndReduce` config object. Phase B: add a new `deriveFromStream` pipeline to event-processor — the DDB Stream equivalent of `materializeToTable` (Stream → transform(newImage, oldImage) → WriteIntents back to same table). Phase C: create ledger-ctrl's `snapshot-publisher.ts` as a thin `deriveFromStream` config that watches AccountSnapshot INSERT/MODIFY, diffs previous vs current, and writes BalanceEvent/PortfolioEvent/LedgerEntryEvent/SnapshotHistory.

**Tech Stack:** TypeScript, `@nestfolio/event-processor` (replayAndReduce, deriveFromStream, EgestionEngine, IntentExecutor), CDK (DynamoEventSource, Egress), Jest.

---

## File Structure

### Phase A — Generic `replayAndReduce` + ledger-ctrl migration

```
libs/event-processor/
  src/pipelines/replay-and-reduce.ts           # MODIFY — fix FilterExpression, add RequestContext extraction
  test/pipelines/replay-and-reduce.test.ts      # MODIFY — update tests for new behavior

services/ledger/ledger-ctrl/
  src/handlers/reducer.ts                       # REWRITE — thin config object calling replayAndReduce
  src/repositories/ledger.repository.ts         # MODIFY — split out saveSnapshot (no derived events), deprecate saveSnapshotWithEvents
  test/handlers/reducer.test.ts                 # REWRITE — test config callbacks + integration via replayAndReduce
```

### Phase B — `deriveFromStream` pipeline in event-processor

```
libs/event-processor/
  src/pipelines/derive-from-stream.ts           # CREATE — generic DDB Stream → transform(new, old) → WriteIntents pipeline
  src/pipelines/index.ts                        # MODIFY — export deriveFromStream
  src/index.ts                                  # MODIFY — export deriveFromStream
  test/pipelines/derive-from-stream.test.ts     # CREATE — unit tests
```

### Phase C — Ledger-ctrl snapshot CDC pipeline

```
services/ledger/ledger-ctrl/
  src/handlers/snapshot-publisher.ts            # CREATE — thin deriveFromStream config, watches AccountSnapshot
  src/transforms/snapshot-to-events.ts          # CREATE — diff prev vs new snapshot, return WriteIntent[]
  src/service.stack.ts                          # MODIFY — add SnapshotPublisher Lambda + DDB stream source
  test/handlers/snapshot-publisher.test.ts       # CREATE — unit tests
  test/transforms/snapshot-to-events.test.ts     # CREATE — unit tests for diff logic
```

---

## Resolved ambiguities

1. **`conventionQuery` FilterExpression:** The current `replayAndReduce` uses `FilterExpression: 'sequenceNo > :seq'` which is wasteful (reads all events then filters post-retrieval). However, `sequenceNo` is NOT a key attribute — the main table uses `pk`/`sk`. There is no GSI on `sequenceNo`. The alternative is encoding `sequenceNo` into the sk (e.g., `Event#000001`) so `begins_with` + `sk > :start` works as a key condition. ledger-ctrl already uses sk = `Event#${eventId}` (not sequence-based), so changing this would require migrating existing data. **Decision:** Keep the `queryEvents` override as the primary path (ledger-ctrl provides its own query via repository). Remove `conventionQuery` entirely — it's unused and encourages the wrong pattern. Services MUST provide `queryEvents`.

2. **RequestContext in `replayAndReduce`:** The generic pipeline needs `tenantId`, `userId`, `region` for the snapshot PutItem (CDC uses these for the event envelope). These come from the DDB Stream records. **Decision:** Add a `requestContext` config callback `(groupKey: string, records: StreamRecord[]) => RequestContext` that the service implements. The generic pipeline passes it to the save step.

3. **Snapshot save in Phase A:** The generic `replayAndReduce` currently uses raw `PutCommand` with optimistic locking. In Phase B, the snapshot is a simple DDB write (no derived events), and CDC handles the rest. **Decision:** Keep the optimistic-lock PutCommand in `replayAndReduce` — it's the right pattern for snapshot materialization. Add `saveSnapshot` config callback so services can customize the write (repository vs raw Put). Default: raw PutCommand with version/lastEventSequence.

4. **`deriveFromStream` pipeline:** There's no existing event-processor pipeline for "DDB Stream → internal table writes." `changeDataCapture` publishes to EventBridge; `materializeToTable` consumes SQS. We need the third pattern: DDB Stream → transform(newImage, oldImage) → WriteIntents back to same table. **Decision:** Create `deriveFromStream` as a new event-processor pipeline. It uses `EgestionEngine` internally and `IntentExecutor` for writes, but services only see a config object (filter, transform, table).

5. **Egress for AccountSnapshot:** Currently the Egress construct only watches BalanceEvent, PortfolioEvent, LedgerEntryEvent. The snapshot-publisher is a standalone DDB Stream consumer Lambda (like the reducer), NOT an Egress handler. It watches INSERT/MODIFY of `__typename = 'AccountSnapshot'` and writes BalanceEvent/PortfolioEvent/LedgerEntryEvent/SnapshotHistory rows. Those rows then get picked up by the existing Egress CDC publisher.

6. **`saveSnapshotWithEvents` cleanup:** After Phase C, the reducer no longer writes derived events. `saveSnapshotWithEvents` becomes `saveSnapshot` (just the snapshot PutItem). The derived-event columns (`balanceChanged`, `positionsChanged`) move to the snapshot-publisher transform. **Decision:** In Phase A, add a thin `saveSnapshot` method to the repository. In Phase C, delete `saveSnapshotWithEvents` after the snapshot-publisher is wired.

---

## Phase A — Generic `replayAndReduce` + ledger-ctrl migration

### Task 1: Fix `replayAndReduce` — remove `conventionQuery`, require `queryEvents`

**Files:**
- Modify: `libs/event-processor/src/pipelines/replay-and-reduce.ts`
- Modify: `libs/event-processor/test/pipelines/replay-and-reduce.test.ts`

- [ ] **Step 1: Update the config type — make `queryEvents` required, add `requestContext`, add `saveSnapshot`**

In `libs/event-processor/src/pipelines/replay-and-reduce.ts`, replace the entire `ReplayAndReduceConfig` interface and remove `conventionQuery`:

```ts
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../internal';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import { EgestionEngine } from '../engine/egestion-engine';
import type { RequestContext } from '../types/event-context';

export interface ReplayAndReduceConfig<S> {
  serviceName: string;
  filter?: (record: StreamRecord) => boolean;
  groupBy: {
    key: (record: StreamRecord) => string;
  };
  reducer: (state: S, event: Record<string, unknown>) => S;
  initialState: S | (() => S);
  snapshot: {
    key: (groupKey: string) => { pk: string; sk: string };
    daily?: boolean;
  };
  /** Query events since last checkpoint. Required — no default convention query. */
  queryEvents: (
    groupKey: string,
    lastSequence: number,
    clients: { docClient: DynamoDBDocumentClient; tableName: string },
  ) => Promise<Record<string, unknown>[]>;
  /** Extract RequestContext from the group key and stream records. */
  requestContext: (groupKey: string, records: StreamRecord[]) => RequestContext;
  /**
   * Custom save logic. When provided, replaces the default PutCommand.
   * Receives the reduced state, sequence info, and RequestContext.
   */
  saveSnapshot?: (params: {
    snapshotKey: { pk: string; sk: string };
    state: S;
    lastEventSequence: number;
    version: number;
    requestContext: RequestContext;
    clients: { docClient: DynamoDBDocumentClient; tableName: string };
  }) => Promise<void>;
  table?: string;
  bus?: string;
  concurrency?: number;
}
```

- [ ] **Step 2: Rewrite `replayAndReduce` function to use the new config**

Replace the `replayAndReduce` function body (same file):

```ts
export function replayAndReduce<S>(
  config: ReplayAndReduceConfig<S>,
): (event: DynamoDBStreamEvent) => Promise<void> {
  const tableName = config.table ?? process.env.TABLE_NAME!;
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const clients = { docClient, tableName };

  const processGroup = async (
    groupKey: string,
    records: StreamRecord[],
    _ctx: StreamContext,
  ): Promise<void> => {
    const snapshotKey = config.snapshot.key(groupKey);
    const reqCtx = config.requestContext(groupKey, records);

    // 1. Load current snapshot
    const snapshotResult = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: snapshotKey,
    }));

    const existing = snapshotResult.Item;
    const currentState: S = existing
      ? (existing as unknown as S)
      : (typeof config.initialState === 'function'
        ? (config.initialState as () => S)()
        : config.initialState);
    const lastSeq = (existing?.lastEventSequence as number) ?? 0;
    const currentVersion = (existing?.version as number) ?? 0;

    // 2. Query events since checkpoint
    const events = await config.queryEvents(groupKey, lastSeq, clients);

    if (events.length === 0) {
      logger.info('No new events to reduce', { groupKey });
      return;
    }

    // 3. Sort by sequenceNo (defensive)
    events.sort((a, b) => ((a.sequenceNo as number) ?? 0) - ((b.sequenceNo as number) ?? 0));

    // 4. Reduce
    const nextState = events.reduce(
      (state, event) => config.reducer(state, event),
      currentState,
    );

    // 5. Save snapshot
    const maxSeq = events.reduce(
      (max, e) => Math.max(max, (e.sequenceNo as number) ?? 0),
      0,
    );
    const nextVersion = currentVersion + 1;

    if (config.saveSnapshot) {
      await config.saveSnapshot({
        snapshotKey,
        state: nextState,
        lastEventSequence: maxSeq,
        version: nextVersion,
        requestContext: reqCtx,
        clients,
      });
    } else {
      // Default: optimistic-lock PutCommand
      try {
        await docClient.send(new PutCommand({
          TableName: tableName,
          Item: {
            ...snapshotKey,
            ...(nextState as Record<string, unknown>),
            ...reqCtx,
            __typename: 'AccountSnapshot',
            version: nextVersion,
            lastEventSequence: maxSeq,
            updatedAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(pk) OR version = :v',
          ExpressionAttributeValues: { ':v': currentVersion },
        }));
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
          throw new Error(`Snapshot conflict for ${groupKey} — concurrent update detected`);
        }
        throw err;
      }
    }

    // 6. Daily checkpoint
    if (config.snapshot.daily) {
      const today = new Date().toISOString().slice(0, 10);
      try {
        await docClient.send(new PutCommand({
          TableName: tableName,
          Item: {
            pk: snapshotKey.pk,
            sk: `Snapshot#${today}`,
            ...(nextState as Record<string, unknown>),
            ...reqCtx,
            __typename: 'AccountCheckpoint',
            version: nextVersion,
            lastEventSequence: maxSeq,
            createdAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(pk)',
        }));
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
          logger.info('Daily checkpoint already exists', { groupKey, today });
        } else {
          throw err;
        }
      }
    }

    logger.info('Snapshot updated', { groupKey, version: nextVersion, eventCount: events.length });
  };

  const busName = config.bus ?? process.env.BUS_NAME;

  const engine = new EgestionEngine({
    serviceName: config.serviceName,
    filter: config.filter,
    groupBy: { key: config.groupBy.key },
    processGroup,
    concurrency: config.concurrency,
    busName,
  });

  return (event: DynamoDBStreamEvent) => engine.process(event);
}
```

- [ ] **Step 3: Remove unused imports**

Remove `QueryCommand` from imports (no longer used — `conventionQuery` is gone):

```ts
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
```

- [ ] **Step 4: Update the unit tests**

Rewrite `libs/event-processor/test/pipelines/replay-and-reduce.test.ts`:

```ts
import { replayAndReduce, type ReplayAndReduceConfig } from '../../src/pipelines/replay-and-reduce';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';

jest.mock('../../src/internal', () => {
  const original = jest.requireActual('../../src/internal');
  return {
    ...original,
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({ send: mockSend })),
  },
  GetCommand: jest.fn().mockImplementation((input) => ({ ...input, _cmd: 'Get' })),
  PutCommand: jest.fn().mockImplementation((input) => ({ ...input, _cmd: 'Put' })),
}));
jest.mock('../../src/engine/error-event-publisher', () => ({
  ErrorEventPublisher: jest.fn().mockImplementation(() => ({
    publishErrors: jest.fn().mockResolvedValue(undefined),
  })),
}));

interface TestState { total: number }

const mockQueryEvents = jest.fn();

const testConfig: ReplayAndReduceConfig<TestState> = {
  serviceName: 'test-service',
  filter: (r) => r.__typename === 'Event',
  groupBy: { key: (r) => `${r.tenantId}#stream` },
  reducer: (state, event) => ({ total: state.total + ((event.amount as number) ?? 0) }),
  initialState: { total: 0 },
  snapshot: {
    key: (gk) => {
      const [tenantId] = gk.split('#');
      return { pk: `T#${tenantId}`, sk: 'Snapshot#current' };
    },
  },
  queryEvents: mockQueryEvents,
  requestContext: (gk, records) => ({
    tenantId: gk.split('#')[0],
    userId: (records[0]?.userId as string) ?? 'system',
    region: 'us-east-1',
  }),
};

describe('replayAndReduce', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
  });

  it('returns a handler function', () => {
    const handler = replayAndReduce(testConfig);
    expect(typeof handler).toBe('function');
  });

  it('loads snapshot, queries events, reduces, and saves', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // GetCommand
    mockQueryEvents.mockResolvedValueOnce([
      { eventType: 'ADD', amount: 100, sequenceNo: 1 },
      { eventType: 'ADD', amount: 200, sequenceNo: 2 },
    ]);
    mockSend.mockResolvedValueOnce({}); // PutCommand

    const handler = replayAndReduce(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#1', __typename: 'Event', tenantId: 't1', sequenceNo: 1, userId: 'u1',
        }),
      ],
    });

    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.Item.total).toBe(300);
    expect(putCall.Item.version).toBe(1);
    expect(putCall.Item.lastEventSequence).toBe(2);
    expect(putCall.Item.tenantId).toBe('t1');
  });

  it('applies delta on existing snapshot', async () => {
    mockSend.mockResolvedValueOnce({
      Item: { total: 500, version: 3, lastEventSequence: 10 },
    });
    mockQueryEvents.mockResolvedValueOnce([{ amount: 50, sequenceNo: 11 }]);
    mockSend.mockResolvedValueOnce({});

    const handler = replayAndReduce(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#11', __typename: 'Event', tenantId: 't1', sequenceNo: 11, userId: 'u1',
        }),
      ],
    });

    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.Item.total).toBe(550);
    expect(putCall.Item.version).toBe(4);
  });

  it('skips when no new events from query', async () => {
    mockSend.mockResolvedValueOnce({ Item: { total: 500, version: 3, lastEventSequence: 10 } });
    mockQueryEvents.mockResolvedValueOnce([]);

    const handler = replayAndReduce(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#10', __typename: 'Event', tenantId: 't1', sequenceNo: 10, userId: 'u1',
        }),
      ],
    });

    // Only 1 call (GetCommand), queryEvents returned empty, no PutCommand
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('retries on ConditionalCheckFailedException', async () => {
    mockSend.mockResolvedValueOnce({ Item: { total: 0, version: 1, lastEventSequence: 0 } });
    mockQueryEvents.mockResolvedValueOnce([{ amount: 100, sequenceNo: 1 }]);
    const condError = new Error('ConditionalCheckFailedException');
    condError.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(condError);

    const handler = replayAndReduce(testConfig);
    await expect(handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#1', __typename: 'Event', tenantId: 't1', sequenceNo: 1, userId: 'u1',
        }),
      ],
    })).rejects.toThrow('EgestionBatchError');
  });

  it('filters non-matching records', async () => {
    const handler = replayAndReduce(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Guard#1', __typename: 'Guard', tenantId: 't1',
        }),
      ],
    });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockQueryEvents).not.toHaveBeenCalled();
  });

  it('uses saveSnapshot override when provided', async () => {
    const customSave = jest.fn().mockResolvedValue(undefined);
    const configWithOverride = { ...testConfig, saveSnapshot: customSave };

    mockSend.mockResolvedValueOnce({ Item: undefined }); // GetCommand
    mockQueryEvents.mockResolvedValueOnce([{ amount: 999, sequenceNo: 1 }]);

    const handler = replayAndReduce(configWithOverride);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#1', __typename: 'Event', tenantId: 't1', sequenceNo: 1, userId: 'u1',
        }),
      ],
    });

    expect(customSave).toHaveBeenCalledWith(expect.objectContaining({
      state: { total: 999 },
      lastEventSequence: 1,
      version: 1,
      requestContext: expect.objectContaining({ tenantId: 't1' }),
    }));
    // Only 1 DDB call (GetCommand) — save was custom
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('saves daily checkpoint when configured', async () => {
    const configWithDaily = { ...testConfig, snapshot: { ...testConfig.snapshot, daily: true } };

    mockSend.mockResolvedValueOnce({ Item: undefined }); // GetCommand
    mockQueryEvents.mockResolvedValueOnce([{ amount: 100, sequenceNo: 1 }]);
    mockSend.mockResolvedValueOnce({}); // PutCommand (snapshot)
    mockSend.mockResolvedValueOnce({}); // PutCommand (daily checkpoint)

    const handler = replayAndReduce(configWithDaily);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#1', __typename: 'Event', tenantId: 't1', sequenceNo: 1, userId: 'u1',
        }),
      ],
    });

    expect(mockSend).toHaveBeenCalledTimes(3);
    const dailyPut = mockSend.mock.calls[2][0];
    const today = new Date().toISOString().slice(0, 10);
    expect(dailyPut.Item.sk).toBe(`Snapshot#${today}`);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm nx run event-processor:test --testPathPattern=replay-and-reduce`

Expected: PASS — all 7 tests green.

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/pipelines/replay-and-reduce.ts libs/event-processor/test/pipelines/replay-and-reduce.test.ts
git commit -m "refactor(event-processor): make queryEvents required, remove conventionQuery FilterExpression, add requestContext and saveSnapshot hooks"
```

---

### Task 2: Add `saveSnapshot` method to LedgerRepository

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts`

- [ ] **Step 1: Add the `saveSnapshot` method**

Add this method to `LedgerRepository`, after `getLatestSnapshot`:

```ts
  readonly saveSnapshot = this.log('saveSnapshot',
    async (
      streamType: 'actual' | 'simulated',
      state: SnapshotState,
      lastEventSequence: number,
      version: number,
      ctx: RequestContext,
    ): Promise<void> => {
      const now = getTime();
      const pk = `Account#${ctx.tenantId}#${streamType}`;
      const totalValueCents = this.computeTotalValue(state);

      try {
        await this.docClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: {
              pk,
              sk: 'Snapshot#latest',
              __typename: 'AccountSnapshot',
              ...ctx,
              timestamp: now,
              streamType,
              positions: state.positions,
              cashBalanceCents: state.cashBalanceCents,
              totalValueCents,
              positionCount: Object.keys(state.positions).length,
              lastEventSequence,
              version,
              snapshotAt: now,
            },
            ConditionExpression: 'attribute_not_exists(pk) OR version = :v',
            ExpressionAttributeValues: { ':v': version - 1 },
          }),
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
          throw new Error(`Snapshot conflict for ${pk} — concurrent update detected`);
        }
        throw err;
      }
    },
  );
```

- [ ] **Step 2: Run tests**

Run: `pnpm nx run ledger-ctrl:test`

Expected: PASS — no behavior change, new method is additive.

- [ ] **Step 3: Commit**

```bash
git add services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts
git commit -m "feat(ledger-ctrl): add saveSnapshot method to LedgerRepository for replayAndReduce migration"
```

---

### Task 3: Migrate ledger-ctrl reducer to `replayAndReduce`

**Files:**
- Rewrite: `services/ledger/ledger-ctrl/src/handlers/reducer.ts`
- Rewrite: `services/ledger/ledger-ctrl/test/handlers/reducer.test.ts`

- [ ] **Step 1: Rewrite `reducer.ts` as a thin config**

Replace `services/ledger/ledger-ctrl/src/handlers/reducer.ts`:

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { replayAndReduce, requireEnv, asTenantId, asUserId, type RequestContext } from '@nestfolio/event-processor';
import { type LedgerEntry } from '@nestfolio/event-processor/sourcing';
import { accountReducer, INITIAL_ACCOUNT_STATE, type AccountState } from '../domain';
import { LedgerRepository } from '../repositories/ledger.repository';

const TABLE_NAME = requireEnv('TABLE_NAME');

const dynamoClient = new DynamoDBClient({});
const repository = new LedgerRepository(TABLE_NAME, dynamoClient);

export const handler = replayAndReduce<AccountState>({
  serviceName: 'ledger-ctrl',
  filter: (record) => record.__typename === 'LedgerEntry',
  groupBy: {
    key: (record) => `${record.tenantId as string}#${record.streamType as string}`,
  },
  reducer: (state, event) => accountReducer(state, event as unknown as LedgerEntry),
  initialState: INITIAL_ACCOUNT_STATE,
  snapshot: {
    key: (gk) => {
      const [tenantId, streamType] = gk.split('#');
      return { pk: `Account#${tenantId}#${streamType}`, sk: 'Snapshot#latest' };
    },
  },
  queryEvents: async (groupKey, lastSequence) => {
    const [tenantId, streamType] = groupKey.split('#');
    return repository.queryEntriesSince(tenantId, streamType, lastSequence);
  },
  requestContext: (groupKey, records) => {
    const [tenantId] = groupKey.split('#');
    const firstRecord = records[0];
    return {
      tenantId: asTenantId(tenantId),
      userId: asUserId((firstRecord?.userId as string) ?? 'system'),
      region: (firstRecord?.region as string) ?? process.env['AWS_REGION'] ?? 'us-east-1',
    } satisfies RequestContext;
  },
  saveSnapshot: async ({ snapshotKey, state, lastEventSequence, version, requestContext }) => {
    const [, streamType] = snapshotKey.pk.replace('Account#', '').split('#');
    await repository.saveSnapshot(
      streamType as 'actual' | 'simulated',
      state,
      lastEventSequence,
      version,
      requestContext,
    );
  },
  table: TABLE_NAME,
});
```

- [ ] **Step 2: Rewrite `reducer.test.ts`**

Replace `services/ledger/ledger-ctrl/test/handlers/reducer.test.ts`:

```ts
/**
 * Tests for ledger-ctrl reducer handler (replayAndReduce config).
 *
 * Strategy: mock replayAndReduce to capture the config, then test the
 * config callbacks (filter, groupBy.key, reducer, queryEvents, requestContext, saveSnapshot).
 */

let capturedConfig: any;

jest.mock('@nestfolio/event-processor', () => {
  const actual = jest.requireActual('@nestfolio/event-processor');
  return {
    ...actual,
    replayAndReduce: jest.fn().mockImplementation((config) => {
      capturedConfig = config;
      return jest.fn(); // handler function
    }),
    requireEnv: jest.fn(() => 'test-table'),
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  };
});

jest.mock('../../src/repositories/ledger.repository', () => ({
  LedgerRepository: jest.fn().mockImplementation(() => ({
    getLatestSnapshot: jest.fn(),
    queryEntriesSince: jest.fn().mockResolvedValue([]),
    saveSnapshot: jest.fn().mockResolvedValue(undefined),
    saveSnapshotWithEvents: jest.fn(),
  })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}));

process.env['TABLE_NAME'] = 'test-table';

import { replayAndReduce } from '@nestfolio/event-processor';
import { LedgerRepository } from '../../src/repositories/ledger.repository';
import { handler } from '../../src/handlers/reducer';
import { INITIAL_ACCOUNT_STATE } from '../../src/domain';

describe('ledger-ctrl reducer handler', () => {
  it('should call replayAndReduce with correct config', () => {
    expect(replayAndReduce).toHaveBeenCalledTimes(1);
    expect(capturedConfig.serviceName).toBe('ledger-ctrl');
    expect(capturedConfig.filter).toBeDefined();
    expect(capturedConfig.groupBy?.key).toBeDefined();
    expect(capturedConfig.reducer).toBeDefined();
    expect(capturedConfig.queryEvents).toBeDefined();
    expect(capturedConfig.requestContext).toBeDefined();
    expect(capturedConfig.saveSnapshot).toBeDefined();
  });

  it('handler should be a function', () => {
    expect(typeof handler).toBe('function');
  });

  describe('filter', () => {
    it('should accept records with __typename LedgerEntry', () => {
      expect(capturedConfig.filter({ __typename: 'LedgerEntry' })).toBe(true);
    });

    it('should reject records with other __typename', () => {
      expect(capturedConfig.filter({ __typename: 'AccountSnapshot' })).toBe(false);
    });

    it('should reject records with no __typename', () => {
      expect(capturedConfig.filter({})).toBe(false);
    });
  });

  describe('groupBy.key', () => {
    it('should group by tenantId#streamType', () => {
      expect(capturedConfig.groupBy.key({ tenantId: 'tenant-1', streamType: 'actual' }))
        .toBe('tenant-1#actual');
    });

    it('should produce distinct keys for different tenants', () => {
      const k1 = capturedConfig.groupBy.key({ tenantId: 'a', streamType: 'actual' });
      const k2 = capturedConfig.groupBy.key({ tenantId: 'b', streamType: 'actual' });
      expect(k1).not.toBe(k2);
    });

    it('should produce distinct keys for different stream types', () => {
      const k1 = capturedConfig.groupBy.key({ tenantId: 'a', streamType: 'actual' });
      const k2 = capturedConfig.groupBy.key({ tenantId: 'a', streamType: 'simulated' });
      expect(k1).not.toBe(k2);
    });
  });

  describe('snapshot.key', () => {
    it('should return correct pk/sk', () => {
      const key = capturedConfig.snapshot.key('tenant-1#actual');
      expect(key).toEqual({ pk: 'Account#tenant-1#actual', sk: 'Snapshot#latest' });
    });
  });

  describe('requestContext', () => {
    it('should extract tenantId from groupKey and userId/region from records', () => {
      const ctx = capturedConfig.requestContext('tenant-1#actual', [
        { userId: 'user-1', region: 'us-west-2' },
      ]);
      expect(ctx.tenantId).toBe('tenant-1');
      expect(ctx.userId).toBe('user-1');
      expect(ctx.region).toBe('us-west-2');
    });

    it('should default userId and region when not in records', () => {
      const ctx = capturedConfig.requestContext('tenant-1#actual', [{}]);
      expect(ctx.userId).toBe('system');
      expect(ctx.region).toBe('us-east-1');
    });
  });

  describe('reducer', () => {
    it('should apply accountReducer to state and event', () => {
      const result = capturedConfig.reducer(INITIAL_ACCOUNT_STATE, {
        eventId: 'e1',
        eventType: 'ORDER_FILLED',
        payload: {
          orderId: 'o1', symbol: 'AAPL', side: 'BUY',
          quantity: 10, fillPrice: 150.0, filledAt: '2025-01-01T00:00:00.000Z',
        },
        sequenceNo: 1,
      });
      expect(result.positions['AAPL']).toBeDefined();
      expect(result.positions['AAPL'].quantity).toBe(10);
    });
  });

  describe('saveSnapshot', () => {
    const mockRepo = (LedgerRepository as unknown as jest.Mock).mock.results[0].value;

    it('should delegate to repository.saveSnapshot', async () => {
      await capturedConfig.saveSnapshot({
        snapshotKey: { pk: 'Account#t1#actual', sk: 'Snapshot#latest' },
        state: INITIAL_ACCOUNT_STATE,
        lastEventSequence: 5,
        version: 2,
        requestContext: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
        clients: {},
      });

      expect(mockRepo.saveSnapshot).toHaveBeenCalledWith(
        'actual',
        INITIAL_ACCOUNT_STATE,
        5,
        2,
        { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
      );
    });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm nx run ledger-ctrl:test`

Expected: PASS — all tests green.

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-ctrl/src/handlers/reducer.ts services/ledger/ledger-ctrl/test/handlers/reducer.test.ts
git commit -m "refactor(ledger-ctrl): migrate reducer to replayAndReduce config — removes raw EgestionEngine usage"
```

---

## Phase B — `deriveFromStream` pipeline in event-processor

### Task 4: Create the `deriveFromStream` pipeline

**Files:**
- Create: `libs/event-processor/src/pipelines/derive-from-stream.ts`
- Create: `libs/event-processor/test/pipelines/derive-from-stream.test.ts`
- Modify: `libs/event-processor/src/pipelines/index.ts`
- Modify: `libs/event-processor/src/index.ts`

- [ ] **Step 1: Write the pipeline**

Create `libs/event-processor/src/pipelines/derive-from-stream.ts`:

```ts
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import type { WriteIntent } from '../types/write-intent';
import type { EventContext } from '../types/event-context';
import { EgestionEngine } from '../engine/egestion-engine';
import { IntentExecutor, type ExecutorDeps } from '../engine/intent-executor';
import { logger, getUUID } from '../internal';

export interface DeriveFromStreamConfig {
  serviceName: string;
  /** Filter stream records (e.g., by __typename). */
  filter?: (record: StreamRecord) => boolean;
  /**
   * Transform a stream record into WriteIntents.
   * `previous` is the OldImage (undefined on INSERT).
   */
  transform: (
    current: StreamRecord,
    previous: StreamRecord | undefined,
    ctx: StreamContext,
  ) => WriteIntent[] | Promise<WriteIntent[]>;
  table?: string;
  bus?: string;
  concurrency?: number;
  errorEventType?: string;
}

export function deriveFromStream(
  config: DeriveFromStreamConfig,
): (event: DynamoDBStreamEvent) => Promise<void> {
  const tableName = config.table ?? process.env.TABLE_NAME!;
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const executorDeps: ExecutorDeps = { docClient, tableName };

  const processRecord = async (record: StreamRecord, ctx: StreamContext): Promise<void> => {
    const previous = ctx.oldImage as StreamRecord | undefined;
    const intents = await Promise.resolve(config.transform(record, previous, ctx));

    if (intents.length === 0) return;

    const executor = new IntentExecutor(executorDeps);

    for (const intent of intents) {
      const eventCtx: EventContext = {
        eventId: `derived-${getUUID()}`,
        eventType: intent._tag === 'record' ? (intent as any).typename : 'DERIVED',
        tenantId: (record.tenantId as string) ?? '',
        userId: (record.userId as string) ?? 'system',
        region: (record.region as string) ?? process.env['AWS_REGION'] ?? 'us-east-1',
        timestamp: new Date().toISOString(),
        serviceName: config.serviceName,
        record: ctx.record,
      };

      await executor.execute(intent, eventCtx);
    }

    logger.info('Derived intents written', {
      eventID: ctx.record.eventID,
      intentCount: intents.length,
    });
  };

  const busName = config.bus ?? process.env.BUS_NAME;

  const engine = new EgestionEngine({
    serviceName: config.serviceName,
    filter: config.filter,
    processRecord,
    concurrency: config.concurrency,
    busName,
    errorEventType: config.errorEventType,
  });

  return (event: DynamoDBStreamEvent) => engine.process(event);
}
```

- [ ] **Step 2: Export from pipeline and main index**

In `libs/event-processor/src/pipelines/index.ts`, add:

```ts
export { deriveFromStream } from './derive-from-stream';
export type { DeriveFromStreamConfig } from './derive-from-stream';
```

In `libs/event-processor/src/index.ts`, after the `replayAndReduce` export, add:

```ts
export { deriveFromStream } from './pipelines/derive-from-stream';
export type { DeriveFromStreamConfig } from './pipelines/derive-from-stream';
```

- [ ] **Step 3: Write unit tests**

Create `libs/event-processor/test/pipelines/derive-from-stream.test.ts`:

```ts
import { deriveFromStream, type DeriveFromStreamConfig } from '../../src/pipelines/derive-from-stream';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';
import { record } from '../../src/intents/record';

jest.mock('../../src/internal', () => {
  const original = jest.requireActual('../../src/internal');
  return {
    ...original,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    getUUID: jest.fn(() => 'test-uuid'),
  };
});

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({ send: mockSend })),
  },
  PutCommand: jest.fn().mockImplementation((input) => ({ ...input, _cmd: 'Put' })),
  UpdateCommand: jest.fn().mockImplementation((input) => ({ ...input, _cmd: 'Update' })),
}));
jest.mock('../../src/engine/error-event-publisher', () => ({
  ErrorEventPublisher: jest.fn().mockImplementation(() => ({
    publishErrors: jest.fn().mockResolvedValue(undefined),
  })),
}));

const testConfig: DeriveFromStreamConfig = {
  serviceName: 'test-service',
  filter: (r) => r.__typename === 'Snapshot',
  transform: (current, previous) => {
    const intents = [];
    if (!previous || current.value !== previous.value) {
      intents.push(record('DerivedEvent', {
        tenantId: current.tenantId,
        value: current.value,
      }, { pk: current.pk as string, sk: `Derived#${current.timestamp}` }));
    }
    return intents;
  },
};

describe('deriveFromStream', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';
    mockSend.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
  });

  it('returns a handler function', () => {
    const handler = deriveFromStream(testConfig);
    expect(typeof handler).toBe('function');
  });

  it('transforms INSERT records and executes intents', async () => {
    const handler = deriveFromStream(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Snapshot#latest', __typename: 'Snapshot',
          tenantId: 't1', value: 100, timestamp: '2025-01-01T00:00:00.000Z',
        }),
      ],
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const putCall = mockSend.mock.calls[0][0];
    expect(putCall.Item.__typename).toBe('DerivedEvent');
    expect(putCall.Item.value).toBe(100);
  });

  it('skips when transform returns empty array', async () => {
    const noOpConfig: DeriveFromStreamConfig = {
      ...testConfig,
      transform: () => [],
    };

    const handler = deriveFromStream(noOpConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Snapshot#latest', __typename: 'Snapshot',
          tenantId: 't1', value: 100,
        }),
      ],
    });

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('filters non-matching records', async () => {
    const handler = deriveFromStream(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Other#1', __typename: 'Other', tenantId: 't1',
        }),
      ],
    });

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('supports async transforms', async () => {
    const asyncConfig: DeriveFromStreamConfig = {
      ...testConfig,
      transform: async (current) => [
        record('AsyncDerived', { value: current.value }, { pk: current.pk as string, sk: 'Async#1' }),
      ],
    };

    const handler = deriveFromStream(asyncConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Snapshot#latest', __typename: 'Snapshot',
          tenantId: 't1', value: 42,
        }),
      ],
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm nx run event-processor:test --testPathPattern=derive-from-stream`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/pipelines/derive-from-stream.ts libs/event-processor/src/pipelines/index.ts libs/event-processor/src/index.ts libs/event-processor/test/pipelines/derive-from-stream.test.ts
git commit -m "feat(event-processor): add deriveFromStream pipeline — DDB Stream to WriteIntents for internal table materialization"
```

---

## Phase C — Ledger-ctrl snapshot CDC pipeline

### Task 5: Create `snapshot-to-events` transform

**Files:**
- Create: `services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts`
- Create: `services/ledger/ledger-ctrl/test/transforms/snapshot-to-events.test.ts`

- [ ] **Step 1: Write failing tests for the transform**

Create `services/ledger/ledger-ctrl/test/transforms/snapshot-to-events.test.ts`:

```ts
import { snapshotToEvents } from '../../src/transforms/snapshot-to-events';

describe('snapshotToEvents transform', () => {
  const baseSnapshot = {
    pk: 'Account#t1#actual',
    sk: 'Snapshot#latest',
    __typename: 'AccountSnapshot',
    tenantId: 't1',
    userId: 'u1',
    region: 'us-east-1',
    streamType: 'actual',
    timestamp: '2025-01-01T00:00:00.000Z',
    positions: { AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 155 } },
    cashBalanceCents: 5_000_000,
    totalValueCents: 5_155_000,
    positionCount: 1,
    lastEventSequence: 5,
    version: 2,
    snapshotAt: '2025-01-01T00:00:00.000Z',
  };

  it('should emit BalanceEvent + PortfolioEvent + LedgerEntryEvent + SnapshotHistory on INSERT (no previous)', () => {
    const intents = snapshotToEvents(baseSnapshot, undefined);

    const types = intents.map((i) => i.typename);
    expect(types).toContain('BalanceEvent');
    expect(types).toContain('PortfolioEvent');
    expect(types).toContain('LedgerEntryEvent');
    expect(types).toContain('SnapshotHistory');
    expect(intents.length).toBe(4);
  });

  it('should emit only LedgerEntryEvent + SnapshotHistory when balance and positions unchanged', () => {
    const intents = snapshotToEvents(baseSnapshot, baseSnapshot);

    const types = intents.map((i) => i.typename);
    expect(types).not.toContain('BalanceEvent');
    expect(types).not.toContain('PortfolioEvent');
    expect(types).toContain('LedgerEntryEvent');
    expect(types).toContain('SnapshotHistory');
    expect(intents.length).toBe(2);
  });

  it('should emit BalanceEvent when only cash changed', () => {
    const prev = { ...baseSnapshot, cashBalanceCents: 10_000_000 };
    const intents = snapshotToEvents(baseSnapshot, prev);

    const types = intents.map((i) => i.typename);
    expect(types).toContain('BalanceEvent');
    expect(types).not.toContain('PortfolioEvent');
  });

  it('should emit PortfolioEvent when only positions changed', () => {
    const prev = { ...baseSnapshot, positions: {} };
    const intents = snapshotToEvents(baseSnapshot, prev);

    const types = intents.map((i) => i.typename);
    expect(types).not.toContain('BalanceEvent');
    expect(types).toContain('PortfolioEvent');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx run ledger-ctrl:test --testPathPattern=snapshot-to-events`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the transform**

Create `services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts`:

```ts
import { record, type RecordIntent } from '@nestfolio/event-processor';

export interface SnapshotRecord {
  pk: string;
  sk: string;
  __typename: string;
  tenantId: string;
  streamType: string;
  timestamp: string;
  positions: Record<string, unknown>;
  cashBalanceCents: number;
  totalValueCents: number;
  positionCount?: number;
  lastEventSequence: number;
  version: number;
  snapshotAt: string;
  [key: string]: unknown;
}

export function snapshotToEvents(
  current: SnapshotRecord,
  previous: SnapshotRecord | undefined,
): RecordIntent[] {
  const { pk, streamType, timestamp, lastEventSequence } = current;
  const sk = (typename: string) => `${typename}#${timestamp}#${lastEventSequence}`;
  const overrides = (typename: string) => ({ pk, sk: sk(typename) });

  const snapshot = {
    positions: current.positions,
    cashBalanceCents: current.cashBalanceCents,
    lastEventSequence,
  };

  const balanceChanged = !previous || current.cashBalanceCents !== previous.cashBalanceCents;
  const positionsChanged = !previous || JSON.stringify(current.positions) !== JSON.stringify(previous.positions);

  const intents: RecordIntent[] = [];

  if (balanceChanged) {
    intents.push(record('BalanceEvent', {
      tenantId: current.tenantId,
      streamType,
      cashBalanceCents: current.cashBalanceCents,
      totalValueCents: current.totalValueCents,
      snapshot,
    }, overrides('BalanceEvent')));
  }

  if (positionsChanged) {
    intents.push(record('PortfolioEvent', {
      tenantId: current.tenantId,
      streamType,
      positions: current.positions,
      positionCount: Object.keys(current.positions).length,
      totalValueCents: current.totalValueCents,
      snapshot,
    }, overrides('PortfolioEvent')));
  }

  // LedgerEntryEvent — always emitted
  intents.push(record('LedgerEntryEvent', {
    tenantId: current.tenantId,
    streamType,
    lastEventSequence,
    snapshot,
  }, overrides('LedgerEntryEvent')));

  // SnapshotHistory — append-only with TTL
  intents.push(record('SnapshotHistory', {
    tenantId: current.tenantId,
    streamType,
    positions: current.positions,
    cashBalanceCents: current.cashBalanceCents,
    lastEventSequence,
    ttl: Math.floor(Date.now() / 1000) + (365 * 86400),
  }, { pk, sk: `SnapshotAt#${timestamp}` }));

  return intents;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm nx run ledger-ctrl:test --testPathPattern=snapshot-to-events`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts services/ledger/ledger-ctrl/test/transforms/snapshot-to-events.test.ts
git commit -m "feat(ledger-ctrl): add snapshot-to-events transform — diffs prev/current AccountSnapshot and returns derived event intents"
```

---

### Task 6: Create `snapshot-publisher.ts` handler using `deriveFromStream`

**Files:**
- Create: `services/ledger/ledger-ctrl/src/handlers/snapshot-publisher.ts`
- Create: `services/ledger/ledger-ctrl/test/handlers/snapshot-publisher.test.ts`

- [ ] **Step 1: Write the handler as a thin `deriveFromStream` config**

Create `services/ledger/ledger-ctrl/src/handlers/snapshot-publisher.ts`:

```ts
import { deriveFromStream, requireEnv } from '@nestfolio/event-processor';
import { snapshotToEvents, type SnapshotRecord } from '../transforms/snapshot-to-events';

requireEnv('TABLE_NAME');

export const handler = deriveFromStream({
  serviceName: 'ledger-ctrl',
  filter: (record) => record.__typename === 'AccountSnapshot',
  transform: (current, previous) =>
    snapshotToEvents(current as unknown as SnapshotRecord, previous as unknown as SnapshotRecord | undefined),
  errorEventType: 'LEDGER_SNAPSHOT_PUBLISHER_FAILED',
});
```

- [ ] **Step 2: Write unit test**

Create `services/ledger/ledger-ctrl/test/handlers/snapshot-publisher.test.ts`:

```ts
let capturedConfig: any;

jest.mock('@nestfolio/event-processor', () => {
  const actual = jest.requireActual('@nestfolio/event-processor');
  return {
    ...actual,
    deriveFromStream: jest.fn().mockImplementation((config) => {
      capturedConfig = config;
      return jest.fn(); // handler function
    }),
    requireEnv: jest.fn(() => 'test-table'),
  };
});

process.env['TABLE_NAME'] = 'test-table';

import { deriveFromStream } from '@nestfolio/event-processor';
import { handler } from '../../src/handlers/snapshot-publisher';

describe('ledger-ctrl snapshot-publisher handler', () => {
  it('should call deriveFromStream with correct config', () => {
    expect(deriveFromStream).toHaveBeenCalledTimes(1);
    expect(capturedConfig.serviceName).toBe('ledger-ctrl');
    expect(capturedConfig.filter).toBeDefined();
    expect(capturedConfig.transform).toBeDefined();
    expect(capturedConfig.errorEventType).toBe('LEDGER_SNAPSHOT_PUBLISHER_FAILED');
  });

  it('handler should be a function', () => {
    expect(typeof handler).toBe('function');
  });

  describe('filter', () => {
    it('should accept AccountSnapshot records', () => {
      expect(capturedConfig.filter({ __typename: 'AccountSnapshot' })).toBe(true);
    });

    it('should reject non-AccountSnapshot records', () => {
      expect(capturedConfig.filter({ __typename: 'LedgerEntry' })).toBe(false);
    });
  });

  describe('transform', () => {
    it('should delegate to snapshotToEvents and return intents', () => {
      const current = {
        pk: 'Account#t1#actual', sk: 'Snapshot#latest', __typename: 'AccountSnapshot',
        tenantId: 't1', streamType: 'actual', timestamp: '2025-01-01T00:00:00.000Z',
        positions: {}, cashBalanceCents: 5_000_000, totalValueCents: 5_000_000,
        lastEventSequence: 1, version: 1, snapshotAt: '2025-01-01T00:00:00.000Z',
      };
      const intents = capturedConfig.transform(current, undefined, {});
      expect(intents.length).toBeGreaterThan(0);
      expect(intents.some((i: any) => i.typename === 'BalanceEvent')).toBe(true);
    });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm nx run ledger-ctrl:test --testPathPattern=snapshot-publisher`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-ctrl/src/handlers/snapshot-publisher.ts services/ledger/ledger-ctrl/test/handlers/snapshot-publisher.test.ts
git commit -m "feat(ledger-ctrl): add snapshot-publisher as deriveFromStream config — writes derived events from AccountSnapshot stream"
```

---

### Task 7: Wire `snapshot-publisher` in the CDK stack + remove `saveSnapshotWithEvents`

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/service.stack.ts`
- Modify: `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts`
- Modify: `services/ledger/ledger-ctrl/test/handlers/reducer.test.ts` (remove saveSnapshotWithEvents mock)

- [ ] **Step 1: Add SnapshotPublisher Lambda to the stack**

In `services/ledger/ledger-ctrl/src/service.stack.ts`, after the `reducerFn` block and before the `egress` block, add:

```ts
    // Snapshot Publisher: DDB Stream consumer that writes derived events
    // (BalanceEvent, PortfolioEvent, LedgerEntryEvent, SnapshotHistory)
    // from AccountSnapshot INSERT/MODIFY events.
    const snapshotPublisherFn = new NodejsFunction(this, 'SnapshotPublisherFn', {
      ...reducerProps.lambdaProps,
      entry: join(__dirname, 'handlers', 'snapshot-publisher.ts'),
      environment: {
        TABLE_NAME: state.getTable().tableName,
        SERVICE_NAME: 'ledger-ctrl',
      },
    });
    state.getTable().grantReadWriteData(snapshotPublisherFn);

    snapshotPublisherFn.addEventSource(new DynamoEventSource(state.getTable(), {
      startingPosition: StartingPosition.LATEST,
      bisectBatchOnError: true,
      retryAttempts: 3,
      batchSize: reducerProps.ddbStreamBatchSize,
      maxBatchingWindow: reducerProps.ddbStreamMaxBatchingWindow,
      parallelizationFactor: reducerProps.ddbStreamParallelizationFactor,
      filters: [
        FilterCriteria.filter({
          eventName: FilterRule.or(
            FilterRule.isEqual('INSERT'),
            FilterRule.isEqual('MODIFY'),
          ),
          dynamodb: {
            NewImage: {
              __typename: { S: FilterRule.isEqual('AccountSnapshot') },
            },
          },
        }),
      ],
    }));
```

Update `addObservability` to include the new Lambda:

```ts
    this.addObservability({ ingress, egress, extraLambdas: [reducerFn, snapshotPublisherFn] });
```

- [ ] **Step 2: Remove `saveSnapshotWithEvents` from the repository**

In `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts`, delete the entire `saveSnapshotWithEvents` method (lines 136-249) and the `SnapshotWithEvents` interface (lines 36-43).

- [ ] **Step 3: Remove `saveSnapshotWithEvents` from test mocks**

In `services/ledger/ledger-ctrl/test/handlers/reducer.test.ts`, remove `saveSnapshotWithEvents: jest.fn()` from the LedgerRepository mock.

- [ ] **Step 4: Run all ledger-ctrl tests**

Run: `pnpm nx run ledger-ctrl:test`

Expected: PASS — all tests green.

- [ ] **Step 5: Run CDK synth**

Run: `npx cdk synth dev-ledger-ctrl --no-staging -c prefix=dev -c tier=sandbox 2>&1 | tail -5`

Expected: Successfully synthesized to cdk.out/dev-ledger-ctrl.template.json

- [ ] **Step 6: Commit**

```bash
git add services/ledger/ledger-ctrl/src/service.stack.ts services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts services/ledger/ledger-ctrl/test/handlers/reducer.test.ts
git commit -m "feat(ledger-ctrl): wire snapshot-publisher Lambda, remove saveSnapshotWithEvents — derived events now via CDC pipeline"
```

---

### Task 8: Deploy and verify

**Files:** none (deployment only)

- [ ] **Step 1: Deploy ledger-ctrl**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=ledger-ctrl`

Expected: Stack deploys with new SnapshotPublisherFn Lambda + event source mapping.

- [ ] **Step 2: Run e2e tests that exercise the ledger path**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern='fund-account|withdraw-cash|rebalance-on-drift'`

Expected: PASS — fund-account and withdraw-cash exercise ledger-ctrl (ORDER_FILLED → reducer → snapshot → CDC → BalanceEvent/PortfolioEvent → downstream BFFs). The rebalance test verifies PORTFOLIO_DRIFT_DETECTED flow still works.

- [ ] **Step 3: Commit (if any runtime fixes needed)**

Only if Step 2 reveals issues that require code changes.
