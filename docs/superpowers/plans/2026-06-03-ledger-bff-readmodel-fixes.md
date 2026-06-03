# ledger-bff read-model fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ledger-bff's `LEDGER_ENTRY_RECORDED` P2 append-logs (`HistoryEntry`, `Checkpoint`) materialize from the real producer event shape, and give the service a clean, gated `typecheck` target by deleting dead repository code.

**Architecture:** Consumer-side fix in the `materializeToTable` transform `ledgerEntryRecorded` (Ledger domain BFF). The real `LEDGER_ENTRY_RECORDED` carries `{ tenantId, streamType, lastEventSequence, snapshot: { positions, cashBalanceCents, lastEventSequence } }`; the transform re-sources P2-log fields from the snapshot + the EventBridge envelope (`event.id/type/timestamp`). `eventId`/`createdAt` are auto-injected onto `record()` rows by the intent executor, so the transform sets only `eventType`, `sequenceNo`, `payload`, `streamType`. No producer change. Part B deletes the repository's dead write/read methods (the live writer is the transform pipeline) and wires a `typecheck` nx target.

**Tech Stack:** TypeScript, `@nestfolio/event-processor` (record/projectVersioned intents, materializeToTable), Jest (unit), Nx, AppSync JS resolvers, DynamoDB.

**Spec:** `docs/superpowers/specs/2026-06-03-ledger-bff-readmodel-fixes-design.md`

**Run all commands from:** the worktree root `/Users/fabiovitali/WebstormProjects/nestfolio/.claude/worktrees/ledger-bff-readmodel-fixes`.

---

### Task 1: Part A — rewrite `ledgerEntryRecorded` transform (TDD)

**Files:**
- Modify: `services/ledger/ledger-bff/src/transforms/ledger-entry-recorded.ts`
- Test: `services/ledger/ledger-bff/test/unit/transforms/ledger-entry-recorded.test.ts`

- [ ] **Step 1: Replace the unit test with real-producer-shape cases (failing)**

Overwrite `test/unit/transforms/ledger-entry-recorded.test.ts` with:

```ts
import { ledgerEntryRecorded } from '../../../src/transforms/ledger-entry-recorded';

describe('ledgerEntryRecorded transform', () => {
  const makeUow = (subject: Record<string, unknown>) => ({
    event: {
      id: 'e1',
      type: 'LEDGER_ENTRY_RECORDED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  });

  // The shape the real ledger-ctrl producer emits (LedgerEntryEvent).
  const actualSubject = {
    streamType: 'actual',
    lastEventSequence: 42,
    snapshot: {
      positions: { AAPL: { symbol: 'AAPL', quantity: 5, averageCostBasis: 150, totalCostBasis: 750, lastFillPrice: 150 } },
      cashBalanceCents: 250_000,
      lastEventSequence: 42,
    },
  };

  it('writes a HistoryEntry (P2) for an actual entry, keyed on the padded sequence', () => {
    const result = ledgerEntryRecorded(
      makeUow(actualSubject) as Parameters<typeof ledgerEntryRecorded>[0],
    );
    const intents = result as Array<Record<string, unknown>>;
    const hist = intents.find((i) => i.typename === 'HistoryEntry');
    expect(hist).toMatchObject({
      _tag: 'record',
      typename: 'HistoryEntry',
      overrides: { pk: 'History#t1', sk: '00000042' },
    });
    const fields = hist!.fields as Record<string, unknown>;
    expect(fields.eventType).toBe('LEDGER_ENTRY_RECORDED'); // envelope detail-type
    expect(fields.sequenceNo).toBe(42);
    // eventId + createdAt are injected by the record() executor, not the transform.
    expect(fields.eventId).toBeUndefined();
    expect(fields.createdAt).toBeUndefined();
  });

  it('writes one per-date Checkpoint (P2) from the snapshot for an actual entry', () => {
    const result = ledgerEntryRecorded(
      makeUow(actualSubject) as Parameters<typeof ledgerEntryRecorded>[0],
    );
    const intents = result as Array<Record<string, unknown>>;
    const cp = intents.find((i) => i.typename === 'Checkpoint');
    expect(cp).toMatchObject({
      _tag: 'record',
      typename: 'Checkpoint',
      overrides: { pk: 'Checkpoint#t1', sk: '2026-01-01' },
    });
    const fields = cp!.fields as Record<string, unknown>;
    expect(fields.cashBalanceCents).toBe(250_000);
    expect(fields.date).toBe('2026-01-01');
  });

  it('writes versioned Simulation + SimulationPosition and NO history/checkpoint for a simulated entry', () => {
    const result = ledgerEntryRecorded(makeUow({
      streamType: 'simulated',
      lastEventSequence: 9,
      snapshot: {
        positions: { AAPL: { symbol: 'AAPL', quantity: 12, averageCostBasis: 148, totalCostBasis: 1776, lastFillPrice: 155 } },
        cashBalanceCents: 950_000,
        lastEventSequence: 9,
      },
    }) as Parameters<typeof ledgerEntryRecorded>[0]);

    const intents = result as Array<Record<string, unknown>>;

    const sim = intents.find((i) => i.typename === 'Simulation');
    expect(sim).toMatchObject({
      _tag: 'projectVersioned',
      typename: 'Simulation',
      version: 9,
      overrides: { pk: 'Simulation#t1', sk: 'Latest' },
    });
    expect((sim!.fields as Record<string, unknown>).cashBalanceCents).toBe(950_000);

    const simPos = intents.find((i) => i.typename === 'SimulationPosition');
    expect(simPos).toMatchObject({
      _tag: 'projectVersioned',
      typename: 'SimulationPosition',
      version: 9,
      overrides: { pk: 'Simulation#t1', sk: 'Position#AAPL' },
    });
    expect((simPos!.fields as Record<string, unknown>).quantity).toBe(12);

    expect(intents.find((i) => i.typename === 'HistoryEntry')).toBeUndefined();
    expect(intents.find((i) => i.typename === 'Checkpoint')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm nx test ledger-bff --testPathPatterns=ledger-entry-recorded`
Expected: FAIL — the first test expects sk `00000042` but the current transform produces `Entry#undefined`; the simulated test expects no HistoryEntry/Checkpoint but the current transform emits a HistoryEntry unconditionally.

- [ ] **Step 3: Rewrite the transform**

Overwrite `src/transforms/ledger-entry-recorded.ts` with:

```ts
import { record, projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type PositionRecord = {
  symbol: string;
  quantity: number;
  averageCostBasis: number;
  totalCostBasis: number;
  lastFillPrice: number;
};

type LedgerEntryPayload = {
  streamType?: string;
  lastEventSequence?: number;
  snapshot?: {
    positions: Record<string, PositionRecord>;
    cashBalanceCents: number;
    lastEventSequence: number;
  };
};

const HISTORY_SEQ_PAD = 8;

export const ledgerEntryRecorded = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context as {
    tenantId: string;
    userId?: string;
    region?: string;
  };
  const payload = event.subject as LedgerEntryPayload & Record<string, unknown>;

  const snapshot = payload.snapshot;
  const streamType = payload.streamType ?? 'actual';
  const sequenceNo = Number(snapshot?.lastEventSequence ?? payload.lastEventSequence ?? 0);
  const cashBalanceCents = snapshot?.cashBalanceCents ?? 0;
  const positions = snapshot?.positions ?? {};

  // Simulated stream: version-guarded projections fed from the snapshot. No
  // order-history / checkpoint rows — those describe the real account timeline.
  if (streamType === 'simulated') {
    const intents: WriteIntent[] = [
      projectVersioned('Simulation', {
        tenantId,
        userId,
        region,
        cashBalanceCents,
        positions,
      }, {
        version: sequenceNo,
        overrides: { pk: `Simulation#${tenantId}`, sk: 'Latest' },
      }),
    ];
    for (const [symbol, position] of Object.entries(positions)) {
      intents.push(
        projectVersioned('SimulationPosition', {
          tenantId,
          userId,
          region,
          symbol,
          quantity: position.quantity ?? 0,
          averageCostBasis: position.averageCostBasis ?? 0,
          totalCostBasis: position.totalCostBasis ?? 0,
          lastFillPrice: position.lastFillPrice ?? 0,
        }, {
          version: sequenceNo,
          overrides: { pk: `Simulation#${tenantId}`, sk: `Position#${symbol}` },
        }),
      );
    }
    return intents.length === 1 ? intents[0] : intents;
  }

  // Actual stream: append-only order history + one checkpoint per active date.
  // `eventId` and `createdAt` are auto-injected onto record() rows by the intent
  // executor (eventId = ctx.eventId, createdAt = ctx.timestamp) — not set here.
  const paddedSeq = String(sequenceNo).padStart(HISTORY_SEQ_PAD, '0');
  const date = event.timestamp.slice(0, 10);

  return [
    record('HistoryEntry', {
      tenantId,
      userId,
      region,
      eventType: event.type,
      sequenceNo,
      streamType,
      payload: { cashBalanceCents, positions, lastEventSequence: sequenceNo },
    }, {
      pk: `History#${tenantId}`,
      sk: paddedSeq,
    }),
    record('Checkpoint', {
      tenantId,
      userId,
      region,
      date,
      cashBalanceCents,
      positions,
    }, {
      pk: `Checkpoint#${tenantId}`,
      sk: date,
    }),
  ];
};
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm nx test ledger-bff --testPathPatterns=ledger-entry-recorded`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-bff/src/transforms/ledger-entry-recorded.ts services/ledger/ledger-bff/test/unit/transforms/ledger-entry-recorded.test.ts
git commit -m "fix(ledger-bff): materialize HistoryEntry/Checkpoint from real LEDGER_ENTRY_RECORDED shape

Part A of ledger-bff-readmodel-fixes. Re-source the P2 append-logs from
event.subject.snapshot.* + the envelope (event.id/type/timestamp) instead of
non-existent top-level fields. HistoryEntry sk keyed on the padded sequence
(was Entry#undefined → collided); Checkpoint written once per active date
(dropped the %100 gate). Actual stream only."
```

---

### Task 2: Part B — widen the two sibling transform signatures

The `event-listener.ts:15/17/19` errors are the three transform call-sites: `toUow` returns `BusEvent<…, Record<string, unknown>>` but the transforms default the context arg to `RequestContext`. Task 1 already widened `ledgerEntryRecorded`; do the same to the other two.

**Files:**
- Modify: `services/ledger/ledger-bff/src/transforms/balance-updated.ts`
- Modify: `services/ledger/ledger-bff/src/transforms/portfolio-updated.ts`

- [ ] **Step 1: Widen `balance-updated.ts`**

In `src/transforms/balance-updated.ts`, change the signature and the context destructure.

Replace:
```ts
export const balanceUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
```
with:
```ts
export const balanceUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context as {
    tenantId: string;
    userId?: string;
    region?: string;
  };
```

- [ ] **Step 2: Widen `portfolio-updated.ts`**

In `src/transforms/portfolio-updated.ts`, apply the identical change.

Replace:
```ts
export const portfolioUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
```
with:
```ts
export const portfolioUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context as {
    tenantId: string;
    userId?: string;
    region?: string;
  };
```

- [ ] **Step 3: Verify the event-listener errors are gone**

Run: `npx tsc --noEmit -p services/ledger/ledger-bff/tsconfig.json 2>&1 | grep "event-listener.ts" || echo "NO event-listener errors"`
Expected: `NO event-listener errors`.

- [ ] **Step 4: Run the affected unit tests (behavior unchanged)**

Run: `pnpm nx test ledger-bff --testPathPatterns="transforms/(balance-updated|portfolio-updated)"`
Expected: PASS (the tests cast their uow with `as Parameters<typeof fn>[0]`, so the widened signature is compatible; runtime logic is unchanged).

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-bff/src/transforms/balance-updated.ts services/ledger/ledger-bff/src/transforms/portfolio-updated.ts
git commit -m "fix(ledger-bff): align transform signatures to toUow return type

Part B of ledger-bff-readmodel-fixes. Widen the context type arg to match
toUow's BusEvent<…, Record<string, unknown>>, narrowing locally. Resolves the
three event-listener.ts call-site type errors."
```

---

### Task 3: Part B — delete the dead repository methods

The live writer is the `materializeToTable` transform pipeline. `graphql-resolver.ts` + `time-travel.service.ts` use only `getLatest`, `getPositions`, `getSimulationLatest`, `getSimulationPositions`, `getSnapshotAt`. All write methods and `getHistory`/`getCheckpoints`/`getCheckpointBefore`/`getEntriesSince` have no production callers. `noUnusedLocals` is on, so removing the methods requires removing their now-unused imports + interfaces in the same edit.

**Files:**
- Modify: `services/ledger/ledger-bff/src/repositories/portfolio.repository.ts`
- Test: `services/ledger/ledger-bff/test/unit/repositories/portfolio.repository.test.ts`

- [ ] **Step 1: Replace the repository with the live-methods-only version**

Overwrite `src/repositories/portfolio.repository.ts` with:

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, withMethodLogging } from '@nestfolio/event-processor';

export class PortfolioRepository extends TableRepository {
  private readonly log = withMethodLogging('PortfolioRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  // --- Read operations (the only live surface; writes are owned by the
  //     materializeToTable transform pipeline, not this repository) ---

  readonly getLatest = this.log('getLatest',
    async (tenantId: string): Promise<Record<string, unknown> | null> => {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk: `Portfolio#${tenantId}`, sk: 'Latest' },
        }),
      );
      return (result.Item as Record<string, unknown>) ?? null;
    },
  );

  readonly getPositions = this.log('getPositions',
    async (tenantId: string): Promise<Record<string, unknown>[]> => {
      return this.queryByPk(`Portfolio#${tenantId}`, 'Position#');
    },
  );

  readonly getSimulationLatest = this.log('getSimulationLatest',
    async (tenantId: string): Promise<Record<string, unknown> | null> => {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk: `Simulation#${tenantId}`, sk: 'Latest' },
        }),
      );
      return (result.Item as Record<string, unknown>) ?? null;
    },
  );

  readonly getSimulationPositions = this.log('getSimulationPositions',
    async (tenantId: string): Promise<Record<string, unknown>[]> => {
      return this.queryByPk(`Simulation#${tenantId}`, 'Position#');
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
}
```

- [ ] **Step 2: Prune the repository unit test to the live methods**

Overwrite `test/unit/repositories/portfolio.repository.test.ts` with (drops the
`upsertBalance`, `appendHistory`, `saveCheckpoint`, `upsertSimulation`,
`saveSnapshotAt`, `getCheckpointBefore` blocks; keeps `getLatest`, `getPositions`,
`getSimulationLatest`, `getSnapshotAt`):

```ts
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({ send: mockSend })),
    },
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
    GetCommand: jest.fn().mockImplementation((input) => ({ _type: 'Get', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
    UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: 'Update', input })),
  };
});

jest.mock('@nestfolio/event-processor', () => {
  const ddb = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock; QueryCommand: jest.Mock };
  return {
  TableRepository: class {
    protected readonly docClient: { send: jest.Mock };
    protected readonly tableName: string;
    constructor(tableName: string) {
      this.tableName = tableName;
      this.docClient = { send: mockSend };
    }
    protected async put(item: Record<string, unknown>) {
      await this.docClient.send(new ddb.PutCommand({ TableName: this.tableName, Item: item }));
    }
    protected async queryByPk(pk: string, skPrefix?: string) {
      const result = await this.docClient.send(new ddb.QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
      }));
      return result.Items ?? [];
    }
    protected async queryAll(input: unknown) {
      const result = await this.docClient.send(new ddb.QueryCommand(input));
      return result.Items ?? [];
    }
  },
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },

  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

  };
});
import { PortfolioRepository } from '../../../src/repositories/portfolio.repository';

describe('PortfolioRepository', () => {
  let repo: PortfolioRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Items: [] });
    repo = new PortfolioRepository('test-table');
  });

  describe('getLatest', () => {
    it('should return item when found', async () => {
      const item = { pk: 'Portfolio#t1', sk: 'Latest', cashBalanceCents: 100_000 };
      mockSend.mockResolvedValue({ Item: item });

      const result = await repo.getLatest('t1');
      expect(result).toEqual(item);
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValue({});

      const result = await repo.getLatest('t1');
      expect(result).toBeNull();
    });
  });

  describe('getPositions', () => {
    it('should query positions for tenant', async () => {
      const positions = [
        { symbol: 'VTI', quantity: 10 },
        { symbol: 'SPY', quantity: 5 },
      ];
      mockSend.mockResolvedValue({ Items: positions });

      const result = await repo.getPositions('tenant-1');
      expect(result).toHaveLength(2);
    });
  });

  describe('getSimulationLatest', () => {
    it('should return simulation latest when found', async () => {
      const item = { pk: 'Simulation#t1', sk: 'Latest', cashBalanceCents: 100_000 };
      mockSend.mockResolvedValue({ Item: item });

      const result = await repo.getSimulationLatest('t1');
      expect(result).toEqual(item);
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

      const result = await repo.getSnapshotAt('t1', '2025-06-15T12:00:00.000Z');
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

      const result = await repo.getSnapshotAt('t1', '2025-01-01T00:00:00.000Z');
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 3: Verify the repository tsc errors are gone and nothing else broke**

Run: `npx tsc --noEmit -p services/ledger/ledger-bff/tsconfig.json 2>&1 | grep -E "^services/ledger/ledger-bff/src/" || echo "NO src errors"`
Expected: `NO src errors` (all 8 src errors — 3 event-listener + 5 portfolio.repository — are resolved).

- [ ] **Step 4: Run the repository + resolver unit tests**

Run: `pnpm nx test ledger-bff --testPathPatterns="repositories/portfolio.repository|handlers/graphql-resolver"`
Expected: PASS (graphql-resolver.test.ts uses only the retained read methods).

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-bff/src/repositories/portfolio.repository.ts services/ledger/ledger-bff/test/unit/repositories/portfolio.repository.test.ts
git commit -m "refactor(ledger-bff): delete dead repository write/read methods

Part B of ledger-bff-readmodel-fixes. The materializeToTable transform pipeline
is the only live writer; getHistory/getCheckpoints/getCheckpointBefore/
getEntriesSince had no callers either. Removes the 5 TableEntry.timestamp tsc
errors at the source and the stale competing sk scheme. Repo now exposes only the
5 live read methods used by graphql-resolver / time-travel.service."
```

---

### Task 4: Part B — add the gated `typecheck` target

**Files:**
- Create: `services/ledger/ledger-bff/tsconfig.type-test.json`
- Modify: `services/ledger/ledger-bff/project.json`

- [ ] **Step 1: Create the typecheck tsconfig**

Create `services/ledger/ledger-bff/tsconfig.type-test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/types/**/*.ts"]
}
```

This typechecks all of `src` (catching any future event-listener / repository
regressions) plus the `read-model-ownership.type-test.ts` ownership proof, and
excludes the jest unit/integration tests (which run under ts-jest, not strict tsc).

- [ ] **Step 2: Add the `typecheck` target to project.json**

In `services/ledger/ledger-bff/project.json`, add a `typecheck` entry to `targets`
(insert after the `lint` target):

```json
    "lint": { "executor": "@nx/eslint:lint" },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc --noEmit -p services/ledger/ledger-bff/tsconfig.type-test.json"
      }
    }
```

- [ ] **Step 3: Run the new target, verify green**

Run: `pnpm nx run ledger-bff:typecheck`
Expected: PASS — `tsc` exits 0 with no errors.

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-bff/tsconfig.type-test.json services/ledger/ledger-bff/project.json
git commit -m "build(ledger-bff): add typecheck target over src + ownership type-test

Part B of ledger-bff-readmodel-fixes. Wires the WS-D-style typecheck gate that
ledger-bff was missing, scoped to src/** + test/types/** so a clean service-wide
typecheck is enforced via nx affected."
```

---

### Task 5: Part A — align integration test fixtures to the real producer shape

The integration test currently injects the synthetic top-level shape (the shape that hides the bug). Switch every `LEDGER_ENTRY_RECORDED` injection to the real producer shape and update the assertions. This test runs against deployed dev in the validation phase — it is authored here, executed in the closing gate.

**Files:**
- Modify: `services/ledger/ledger-bff/test/integration/ledger-bff.integration.test.ts`

- [ ] **Step 1: Rewrite the standalone HistoryEntry materialization test**

Replace the whole `it('should materialize LEDGER_ENTRY_RECORDED to HistoryEntry in DDB', ...)` block (currently lines ~102–134) with:

```ts
    it('should materialize LEDGER_ENTRY_RECORDED to HistoryEntry in DDB', async () => {
      const lastEventSequence = 1001 + Math.floor(Math.random() * 99); // 1001–1099
      const eventId = `integ-entry-${Date.now()}`;

      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        eventId,
        detail: {
          streamType: 'actual',
          lastEventSequence,
          snapshot: {
            positions: { AAPL: { symbol: 'AAPL', quantity: 5, averageCostBasis: 150.0, totalCostBasis: 750.0, lastFillPrice: 150.0 } },
            cashBalanceCents: 250_000,
            lastEventSequence,
          },
        },
      });

      // record() with sk override → pk: History#<tenantId>, sk: <8-digit padded seq>
      const sk = String(lastEventSequence).padStart(8, '0');
      const item = await table.waitForItem({
        table: 'ledger-bff',
        pk: `History#${ctx.tenantId}`,
        sk,
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('HistoryEntry');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['eventType']).toBe('LEDGER_ENTRY_RECORDED'); // generic envelope detail-type
      expect(item['sequenceNo']).toBe(lastEventSequence);
      expect(item['eventId']).toBe(eventId);                   // auto-injected by record() executor
      expect(item['createdAt']).toEqual(expect.any(String));   // auto-injected by record() executor
    }, 120_000);
```

- [ ] **Step 2: Rewrite the AppSync-queries `beforeAll` fixtures**

Replace fixtures 3, 4, 5 (the three `LEDGER_ENTRY_RECORDED` injections, currently
lines ~271–348) with the real shape. All actual-stream entries now produce a
Checkpoint keyed on today's processing date, so checkpoint dates are computed at
runtime, not set in the detail:

```ts
      // 3. LEDGER_ENTRY_RECORDED (actual) → HistoryEntry rows (00099001, 00099002)
      //    + a Checkpoint at today's processing date.
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        eventId: 'integ-hist-query-001',
        detail: {
          streamType: 'actual',
          lastEventSequence: 99001,
          snapshot: {
            cashBalanceCents: 800_000,
            positions: { AAPL: { symbol: 'AAPL', quantity: 8, averageCostBasis: 145.0, totalCostBasis: 1160.0, lastFillPrice: 150.0 } },
            lastEventSequence: 99001,
          },
        },
      });
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        eventId: 'integ-hist-query-002',
        detail: {
          streamType: 'actual',
          lastEventSequence: 99002,
          snapshot: {
            cashBalanceCents: 1_000_000,
            positions: {},
            lastEventSequence: 99002,
          },
        },
      });

      // 4. LEDGER_ENTRY_RECORDED (simulated) → Simulation#Latest + SimulationPosition
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        eventId: 'integ-sim-001',
        detail: {
          streamType: 'simulated',
          lastEventSequence: 1,
          snapshot: {
            cashBalanceCents: 950_000,
            lastEventSequence: 1,
            positions: {
              AAPL: { symbol: 'AAPL', quantity: 12, averageCostBasis: 148.0, totalCostBasis: 1776.0, lastFillPrice: 155.0 },
            },
          },
        },
      });
```

- [ ] **Step 3: Rewrite the `beforeAll` materialization waits**

Replace the wait block (currently lines ~350–388, the `await table.waitForItem({...})`
calls for History `Entry#99001`, the two `Checkpoint` dates, and `Simulation`) with:

```ts
      // Wait for all materializations
      const today = new Date().toISOString().slice(0, 10);
      await table.waitForItem({
        table: 'ledger-bff',
        pk: portfolioPk(),
        sk: 'Latest',
        timeoutMs: 90_000,
      });
      await table.waitForItem({
        table: 'ledger-bff',
        pk: portfolioPk(),
        sk: 'Position#AAPL',
        timeoutMs: 30_000,
      });
      await table.waitForItem({
        table: 'ledger-bff',
        pk: historyPk(),
        sk: '00099001',
        timeoutMs: 30_000,
      });
      // One checkpoint per active date — actual entries above land on today.
      await table.waitForItem({
        table: 'ledger-bff',
        pk: checkpointPk(),
        sk: today,
        timeoutMs: 30_000,
      });
      // Wait for simulation
      await table.waitForItem({
        table: 'ledger-bff',
        pk: simulationPk(),
        sk: 'Latest',
        timeoutMs: 30_000,
      });
```

- [ ] **Step 4: Update the `getOrderHistory` assertion (generic eventType)**

In the `it('should return order history page via getOrderHistory', ...)` test, replace
the result assertions (currently lines ~492–497) with:

```ts
      expect(result.getOrderHistory).toBeDefined();
      expect(Array.isArray(result.getOrderHistory.items)).toBe(true);
      // Entries carry the generic envelope detail-type; identify by sequenceNo.
      const entry = result.getOrderHistory.items.find(i => i.sequenceNo === 99001);
      expect(entry).toBeDefined();
      expect(entry!.eventType).toBe('LEDGER_ENTRY_RECORDED');
```

- [ ] **Step 5: Update the `getTimeTravelAvailability` assertion (today's date)**

In the `it('should return TimeTravelAvailability via getTimeTravelAvailability', ...)`
test, replace the result assertions (currently lines ~515–518) with:

```ts
      const today = new Date().toISOString().slice(0, 10);
      expect(result.getTimeTravelAvailability).toBeDefined();
      // One checkpoint per active date — all actual entries above land on today.
      expect(result.getTimeTravelAvailability.earliestDate).toBe(today);
      expect(result.getTimeTravelAvailability.latestDate).toBe(today);
```

- [ ] **Step 6: Refresh the stale sk-scheme comments**

Update the two explanatory comment blocks for accuracy:
- Near line ~37, change the `LEDGER_ENTRY_RECORDED → ... sk: Entry#<sequenceNo>` line to `sk: <8-digit padded lastEventSequence>`.
- Near line ~219–220, change `getOrderHistory → pk: History#<tenantId>` (unchanged) and the `getTimeTravelAvailability` note to read `reads earliestDate/latestDate from sk = processing date`.

- [ ] **Step 7: Typecheck the test file compiles (no run — needs deployed dev)**

Run: `npx tsc --noEmit -p services/ledger/ledger-bff/tsconfig.spec.json 2>&1 | grep "integration/ledger-bff.integration.test.ts" || echo "integration test compiles"`
Expected: `integration test compiles` (or no new errors introduced by the edits).
Note: the live run happens in the closing-phase validation gate (`pnpm nx run ledger-bff:test-integration` against deployed dev), per the spec's validation gate.

- [ ] **Step 8: Commit**

```bash
git add services/ledger/ledger-bff/test/integration/ledger-bff.integration.test.ts
git commit -m "test(ledger-bff): align integration fixtures to real LEDGER_ENTRY_RECORDED shape

Part A of ledger-bff-readmodel-fixes. Inject the producer's snapshot shape
instead of synthetic top-level fields, so the materialization gap is test-visible.
Assert HistoryEntry sk = padded sequence, generic eventType, and per-date
Checkpoint (today's processing date)."
```

---

### Task 6: File the out-of-scope "order history semantics" finding

The spec flags that `eventType` is the generic `"LEDGER_ENTRY_RECORDED"` and `payload`
is a snapshot summary, because the producer derives entries from snapshot diffs, not the
originating `ORDER_FILLED`/`DEPOSIT_DETECTED` cause. A semantically rich order history is a
separate cross-domain concern.

- [ ] **Step 1: File it as a parking-lot backlog item**

Invoke the `backlog-add` skill to create `docs/backlog/ledger-bff-order-history-generic-eventtype.md`
(default `status: parking`, `type: bug`) capturing: getOrderHistory shows generic
`LEDGER_ENTRY_RECORDED` rows with a snapshot-summary payload rather than real order events
(symbol/qty/price); a rich order history would source from Execution-domain order events;
discovered during `ledger-bff-readmodel-fixes`. The skill runs `backlog-lint --fix` and
commits.

---

## Self-Review

**Spec coverage:**
- Part A HistoryEntry/Checkpoint re-source → Task 1 (transform + unit test) + Task 5 (integration fixtures). ✓
- Part A field-source table (eventType←event.type, sequenceNo/cash/positions←snapshot, eventId/createdAt auto-injected) → Task 1 transform + asserted in Task 1/Task 5. ✓
- Part A actual-stream gating + drop %100 + per-date checkpoint → Task 1 transform + Task 5 assertions. ✓
- Part B delete dead methods → Task 3. ✓
- Part B transform-signature/event-listener fix → Task 1 (ledgerEntryRecorded) + Task 2 (balance/portfolio). ✓
- Part B typecheck target → Task 4. ✓
- Tests: unit rewrite (Task 1), integration alignment (Task 5), repo test prune (Task 3). ✓
- Out-of-scope order-history finding filed → Task 6. ✓
- Validation gate (typecheck green, affected test/lint, deploy + integration) → Task 4 + closing phase. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `ledgerEntryRecorded`/`balanceUpdated`/`portfolioUpdated` all use
`UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>` consistently; the
HistoryEntry sk (`${paddedSeq}`, 8-digit) matches between transform (Task 1), unit test
(`00000042`), and integration test (`padStart(8,'0')`, `00099001`); Checkpoint sk = date
string consistent across transform, unit test (`2026-01-01`), and integration (`today`). ✓
