# Reconciliation Cache-and-Compare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix reconciliation-ctrl so it actually detects drift by caching intent and settlement position snapshots separately and reconciling when both sources are available.

**Architecture:** Each handler caches its side (intent from PORTFOLIO_UPDATED, settlement from ALPACA_ACCOUNT_SNAPSHOT) in the reconciliation-ctrl DDB table. After caching, it reads the other side. If both exist within a staleness window, it calls `reconcile()` with genuinely different data. CDC from DriftRecord INSERT emits PORTFOLIO_DRIFT_DETECTED → advisory-adpt → advisory-ctrl. E2e scenario 13 validates the full chain.

**Tech Stack:** TypeScript, `@nestfolio/event-processor` (materializeToTable), DynamoDB, Jest. No CDK changes needed (table already exists, no new Lambdas).

---

## File Structure

```
services/ledger/reconciliation-ctrl/
  src/handlers/event-listener.ts                # REWRITE — cache-and-compare handlers
  src/repositories/reconciliation.repository.ts # MODIFY — add putPositionSnapshot, getPositionSnapshot
  src/services/reconciliation.service.ts        # NO CHANGE (already correct)
  src/domain/events.ts                          # NO CHANGE
  src/service.stack.ts                          # NO CHANGE
  test/event-listener.test.ts                   # REWRITE — test cache-and-compare behavior
  test/reconciliation.repository.test.ts        # MODIFY — add tests for new methods

apps/e2e-feature-tests/
  src/advisory/reconciliation-correction.e2e.test.ts  # CREATE — scenario 13
  src/helpers/fixtures.ts                              # MODIFY — add withSettlementSnapshot fixture
```

---

## Resolved ambiguities

1. **Positions format mismatch:** PORTFOLIO_UPDATED CDC sends `positions` as `Record<string, PositionSnapshot>` (object keyed by symbol). ALPACA_ACCOUNT_SNAPSHOT sends `positions` as `Array<{ symbol, qty, marketValue }>`. Both need normalization to `Array<{ instrument: string, quantity: number }>`. **Decision:** Create a `normalizePositions` helper that handles both formats.

2. **Staleness window:** Only reconcile if both snapshots were captured within 24 hours of each other. If one side is stale, just cache the fresh side and wait. **Decision:** 24-hour window, configurable via `STALENESS_WINDOW_MS` env var (default 86400000).

3. **Which event triggers reconciliation?** The side that arrives SECOND triggers reconciliation (it reads the other and finds it's fresh). If ALPACA_ACCOUNT_SNAPSHOT arrives daily and PORTFOLIO_UPDATED arrives on every trade, reconciliation effectively runs daily when the broker snapshot arrives. **Decision:** Both handlers try to reconcile. The second one to arrive succeeds.

4. **DDB schema for cached snapshots:** `pk: PositionCache#${tenantId}`, `sk: 'Intent'` or `sk: 'Settlement'`. Each stores normalized positions + `capturedAt` timestamp. **Decision:** Use unconditional PutItem (latest wins — no version conflicts).

5. **The PORTFOLIO_UPDATED positions bug:** The handler currently casts `subject.positions` as an array but CDC sends an object. The `normalizePositions` helper fixes this. **Decision:** Detect format via `Array.isArray()` — if array use it directly, if object extract values.

6. **Reconciliation ID:** Both handlers use `ctx.eventId` as the reconciliation ID. When the second handler triggers reconciliation, it uses its own eventId. **Decision:** Keep using eventId — each reconciliation run is tied to the triggering event.

---

## Task 1: Add position snapshot methods to ReconciliationRepository

**Files:**
- Modify: `services/ledger/reconciliation-ctrl/src/repositories/reconciliation.repository.ts`
- Modify: `services/ledger/reconciliation-ctrl/test/reconciliation.repository.test.ts`

- [ ] **Step 1: Add `PositionSnapshot` type and repository methods**

In `services/ledger/reconciliation-ctrl/src/repositories/reconciliation.repository.ts`, add after the existing `lockPk` function:

```ts
function positionCachePk(tenantId: string): string {
  return `PositionCache#${tenantId}`;
}

export interface CachedPositionSnapshot {
  readonly side: 'Intent' | 'Settlement';
  readonly positions: Array<{ instrument: string; quantity: number }>;
  readonly capturedAt: string;
  readonly sourceEventType: string;
}
```

Add these methods to the `ReconciliationRepository` class, after `isLocked`:

```ts
  readonly putPositionSnapshot = this.log('putPositionSnapshot',
    async (
      tenantId: string,
      side: 'Intent' | 'Settlement',
      positions: Array<{ instrument: string; quantity: number }>,
      sourceEventType: string,
    ): Promise<void> => {
      const now = getTime();
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk: positionCachePk(tenantId),
            sk: side,
            __typename: 'PositionCache',
            tenantId,
            side,
            positions,
            sourceEventType,
            capturedAt: now,
            timestamp: now,
          },
        }),
      );
    },
  );

  readonly getPositionSnapshot = this.log('getPositionSnapshot',
    async (
      tenantId: string,
      side: 'Intent' | 'Settlement',
    ): Promise<CachedPositionSnapshot | null> => {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk: positionCachePk(tenantId), sk: side },
        }),
      );
      if (!result.Item) return null;
      return {
        side: result.Item.side as 'Intent' | 'Settlement',
        positions: result.Item.positions as Array<{ instrument: string; quantity: number }>,
        capturedAt: result.Item.capturedAt as string,
        sourceEventType: result.Item.sourceEventType as string,
      };
    },
  );
```

- [ ] **Step 2: Add tests for the new methods**

Append to `services/ledger/reconciliation-ctrl/test/reconciliation.repository.test.ts` inside the top-level describe block:

```ts
  describe('putPositionSnapshot / getPositionSnapshot', () => {
    it('should write and read an Intent snapshot', async () => {
      mockSend.mockResolvedValueOnce({}); // PutCommand
      await repository.putPositionSnapshot('t1', 'Intent', [
        { instrument: 'AAPL', quantity: 100 },
      ], 'PORTFOLIO_UPDATED');
      expect(mockSend).toHaveBeenCalledTimes(1);
      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.Item.pk).toBe('PositionCache#t1');
      expect(putCall.Item.sk).toBe('Intent');
      expect(putCall.Item.__typename).toBe('PositionCache');
      expect(putCall.Item.positions).toEqual([{ instrument: 'AAPL', quantity: 100 }]);
    });

    it('should return null when no snapshot exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined }); // GetCommand
      const result = await repository.getPositionSnapshot('t1', 'Settlement');
      expect(result).toBeNull();
    });

    it('should return cached snapshot when it exists', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          pk: 'PositionCache#t1', sk: 'Settlement', __typename: 'PositionCache',
          side: 'Settlement',
          positions: [{ instrument: 'AAPL', quantity: 50 }],
          capturedAt: '2025-01-01T00:00:00.000Z',
          sourceEventType: 'ALPACA_ACCOUNT_SNAPSHOT',
        },
      });
      const result = await repository.getPositionSnapshot('t1', 'Settlement');
      expect(result).toEqual({
        side: 'Settlement',
        positions: [{ instrument: 'AAPL', quantity: 50 }],
        capturedAt: '2025-01-01T00:00:00.000Z',
        sourceEventType: 'ALPACA_ACCOUNT_SNAPSHOT',
      });
    });
  });
```

- [ ] **Step 3: Run tests**

Run: `pnpm nx run reconciliation-ctrl:test --testPathPattern=reconciliation.repository`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/ledger/reconciliation-ctrl/src/repositories/reconciliation.repository.ts services/ledger/reconciliation-ctrl/test/reconciliation.repository.test.ts
git commit -m "feat(reconciliation-ctrl): add position snapshot cache methods to repository"
```

---

## Task 2: Rewrite event-listener with cache-and-compare logic

**Files:**
- Rewrite: `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts`

- [ ] **Step 1: Rewrite the handler**

Replace `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts`:

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { materializeToTable, record, skip, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv, logger } from '@nestfolio/event-processor';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
import { ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';
import { ReconciliationRepository, type CachedPositionSnapshot } from '../repositories/reconciliation.repository';
import { ReconciliationService } from '../services/reconciliation.service';

const DEFAULT_STALENESS_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface EventListenerDeps {
  readonly reconciliationService: ReconciliationService;
  readonly repository: ReconciliationRepository;
  readonly stalenessWindowMs: number;
}

// ---------------------------------------------------------------------------
// Position normalization
// ---------------------------------------------------------------------------

type PositionEntry = { instrument: string; quantity: number };

/**
 * Normalizes positions from different event formats:
 * - PORTFOLIO_UPDATED CDC: Record<string, { symbol, quantity, ... }> (object keyed by symbol)
 * - ALPACA_ACCOUNT_SNAPSHOT: Array<{ symbol, qty, marketValue }> (array with qty field)
 * - Generic: Array<{ symbol, quantity }> (array with quantity field)
 */
function normalizePositions(
  raw: unknown,
  fieldMapping: { quantityField: 'quantity' | 'qty' },
): PositionEntry[] {
  if (!raw) return [];

  // Array format (ALPACA_ACCOUNT_SNAPSHOT or generic)
  if (Array.isArray(raw)) {
    return raw.map((p: Record<string, unknown>) => ({
      instrument: (p.symbol as string) ?? '',
      quantity: (p[fieldMapping.quantityField] as number) ?? 0,
    }));
  }

  // Object format (PORTFOLIO_UPDATED CDC — Record<string, PositionSnapshot>)
  if (typeof raw === 'object') {
    return Object.values(raw as Record<string, Record<string, unknown>>).map((p) => ({
      instrument: (p.symbol as string) ?? '',
      quantity: (p.quantity as number) ?? 0,
    }));
  }

  return [];
}

// ---------------------------------------------------------------------------
// Staleness check
// ---------------------------------------------------------------------------

function isFresh(snapshot: CachedPositionSnapshot, stalenessMs: number): boolean {
  const age = Date.now() - new Date(snapshot.capturedAt).getTime();
  return age < stalenessMs;
}

// ---------------------------------------------------------------------------
// Cache-and-compare reconciliation
// ---------------------------------------------------------------------------

async function cacheAndReconcile(
  deps: EventListenerDeps,
  mySide: 'Intent' | 'Settlement',
  myPositions: PositionEntry[],
  sourceEventType: string,
  ctx: EventContext,
): Promise<WriteIntent | WriteIntent[]> {
  const tenantId = ctx.tenantId;
  const reconciliationId = ctx.eventId;

  // 1. Cache our side
  await deps.repository.putPositionSnapshot(tenantId, mySide, myPositions, sourceEventType);

  // 2. Read the other side
  const otherSide = mySide === 'Intent' ? 'Settlement' : 'Intent';
  const otherSnapshot = await deps.repository.getPositionSnapshot(tenantId, otherSide);

  // 3. If other side doesn't exist or is stale, just cache and skip
  if (!otherSnapshot || !isFresh(otherSnapshot, deps.stalenessWindowMs)) {
    logger.info('Cached position snapshot, other side not available or stale', {
      tenantId, mySide, otherSideExists: !!otherSnapshot,
    });
    return skip();
  }

  // 4. Both sides available — reconcile
  const intentPositions = mySide === 'Intent' ? myPositions : otherSnapshot.positions;
  const settlementPositions = mySide === 'Settlement' ? myPositions : otherSnapshot.positions;

  const portfolioId = tenantId;
  const result = deps.reconciliationService.reconcile(reconciliationId, {
    tenantId,
    portfolioId,
    intentPositions,
    settlementPositions,
  });

  const pk = `Reconciliation#${tenantId}#${reconciliationId}`;

  return [
    record('ReconciliationResult', {
      tenantId,
      reconciliationId,
      status: result.status,
      driftCount: result.drifts.length,
    }, { pk, sk: 'Reconciliation' }),
    ...result.drifts.map((d) =>
      record('DriftRecord', {
        tenantId,
        reconciliationId,
        instrument: d.instrument,
        intentQty: d.intentQty,
        settlementQty: d.settlementQty,
        drift: d.drift,
      }, { pk, sk: `DriftRecord#${d.instrument}` }),
    ),
  ];
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

const INTENT_EVENT_TYPES = [
  LedgerCtrlEventTypes.PORTFOLIO_UPDATED,
  ExecutionCrossDomainEventTypes.PORTFOLIO_SNAPSHOT_IMPORTED,
  ExecutionCrossDomainEventTypes.CORPORATE_ACTION_APPLIED,
] as const;

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<WriteIntent | WriteIntent[]>> = {};

  // Intent-side events (positions from internal ledger)
  for (const type of INTENT_EVENT_TYPES) {
    handlers[type] = async (payload, ctx) => {
      const positions = normalizePositions(payload.subject?.positions, { quantityField: 'quantity' });
      return cacheAndReconcile(deps, 'Intent', positions, ctx.eventType, ctx);
    };
  }

  // Settlement-side event (positions from broker)
  handlers[ExecutionCrossDomainEventTypes.ALPACA_ACCOUNT_SNAPSHOT] = async (payload, ctx) => {
    const positions = normalizePositions(payload.subject?.positions, { quantityField: 'qty' });
    return cacheAndReconcile(deps, 'Settlement', positions, ctx.eventType, ctx);
  };

  return handlers;
};

// ---------------------------------------------------------------------------
// Production wiring
// ---------------------------------------------------------------------------

const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new ReconciliationRepository(TABLE_NAME, dynamoClient);
const reconciliationService = new ReconciliationService();
const stalenessWindowMs = parseInt(process.env['STALENESS_WINDOW_MS'] ?? `${DEFAULT_STALENESS_MS}`, 10);

const deps: EventListenerDeps = {
  reconciliationService,
  repository,
  stalenessWindowMs,
};

export const handler = materializeToTable({
  serviceName: 'reconciliation-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'RECONCILIATION_CTRL_FAILED',
});
```

- [ ] **Step 2: Commit (implementation only — tests in next task)**

```bash
git add services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts
git commit -m "refactor(reconciliation-ctrl): rewrite handlers with cache-and-compare — intent vs settlement positions"
```

---

## Task 3: Rewrite event-listener tests

**Files:**
- Rewrite: `services/ledger/reconciliation-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Rewrite the test file**

Replace `services/ledger/reconciliation-ctrl/test/event-listener.test.ts`:

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
    DeleteCommand: jest.fn().mockImplementation((input) => ({ _type: 'Delete', input })),
    TransactWriteCommand: jest.fn().mockImplementation((input) => ({ _type: 'TransactWrite', input })),
  };
});

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  TableRepository: class {
    protected readonly docClient: { send: jest.Mock };
    protected readonly tableName: string;
    constructor(tableName: string) {
      this.tableName = tableName;
      this.docClient = { send: mockSend };
    }
    protected async put(item: Record<string, unknown>) {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
    }
    protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
      return true;
    }
    protected async queryByPk(pk: string, skPrefix?: string) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
      }));
      return result.Items ?? [];
    }
    protected async transactWrite(input: unknown) {
      const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new TransactWriteCommand(input));
    }
    protected buildTransactUpdate(pk: string, sk: string, attrs: Record<string, unknown>) {
      const entries = Object.entries(attrs);
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const sets: string[] = [];
      entries.forEach(([k, v], i) => { names[`#a${i}`] = k; values[`:v${i}`] = v; sets.push(`#a${i} = :v${i}`); });
      return { Update: { TableName: this.tableName, Key: { pk, sk }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values } };
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  requireEnv: (name: string) => process.env[name] ?? name,
  withMethodLogging: jest.fn().mockImplementation(() =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';
import { ReconciliationService } from '../src/services/reconciliation.service';
import { ReconciliationRepository } from '../src/repositories/reconciliation.repository';

process.env['TABLE_NAME'] = 'test-table';

describe('reconciliation-ctrl event-listener', () => {
  const reconciliationService = new ReconciliationService();
  const reconcileSpy = jest.spyOn(reconciliationService, 'reconcile');
  const repository = new ReconciliationRepository('test-table');
  const putSnapshotSpy = jest.spyOn(repository, 'putPositionSnapshot');
  const getSnapshotSpy = jest.spyOn(repository, 'getPositionSnapshot');

  const mockDeps: EventListenerDeps = {
    reconciliationService,
    repository,
    stalenessWindowMs: 24 * 60 * 60 * 1000,
  };

  const harness = createTestHarness({
    serviceName: 'reconciliation-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  describe('cache-and-compare — PORTFOLIO_UPDATED (intent side)', () => {
    it('should cache intent positions and skip when no settlement exists', async () => {
      getSnapshotSpy.mockResolvedValueOnce(null); // no settlement cached

      const result = await harness.process([
        fakeSqsRecord('PORTFOLIO_UPDATED', {
          tenantId: 't1', portfolioId: 'p1',
          positions: { AAPL: { symbol: 'AAPL', quantity: 100, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 155 } },
        }, { tenantId: 't1' }),
      ]);

      expect(putSnapshotSpy).toHaveBeenCalledWith('t1', 'Intent', [{ instrument: 'AAPL', quantity: 100 }], 'PORTFOLIO_UPDATED');
      expect(reconcileSpy).not.toHaveBeenCalled();
      expect(result.intents).toHaveLength(0);
    });

    it('should reconcile when fresh settlement exists', async () => {
      getSnapshotSpy.mockResolvedValueOnce({
        side: 'Settlement',
        positions: [{ instrument: 'AAPL', quantity: 90 }],
        capturedAt: new Date().toISOString(), // fresh
        sourceEventType: 'ALPACA_ACCOUNT_SNAPSHOT',
      });

      const result = await harness.process([
        fakeSqsRecord('PORTFOLIO_UPDATED', {
          tenantId: 't1',
          positions: { AAPL: { symbol: 'AAPL', quantity: 100, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 155 } },
        }, { tenantId: 't1', eventId: 'evt-1' }),
      ]);

      expect(reconcileSpy).toHaveBeenCalledWith('evt-1', expect.objectContaining({
        intentPositions: [{ instrument: 'AAPL', quantity: 100 }],
        settlementPositions: [{ instrument: 'AAPL', quantity: 90 }],
      }));
      expect(result.intents.length).toBeGreaterThanOrEqual(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'ReconciliationResult',
        fields: expect.objectContaining({ status: 'DRIFT_DETECTED', driftCount: 1 }),
      });
    });

    it('should skip reconciliation when settlement is stale', async () => {
      getSnapshotSpy.mockResolvedValueOnce({
        side: 'Settlement',
        positions: [{ instrument: 'AAPL', quantity: 90 }],
        capturedAt: '2020-01-01T00:00:00.000Z', // stale
        sourceEventType: 'ALPACA_ACCOUNT_SNAPSHOT',
      });

      await harness.process([
        fakeSqsRecord('PORTFOLIO_UPDATED', {
          tenantId: 't1', positions: [],
        }, { tenantId: 't1' }),
      ]);

      expect(reconcileSpy).not.toHaveBeenCalled();
    });
  });

  describe('cache-and-compare — ALPACA_ACCOUNT_SNAPSHOT (settlement side)', () => {
    it('should cache settlement and reconcile when fresh intent exists', async () => {
      getSnapshotSpy.mockResolvedValueOnce({
        side: 'Intent',
        positions: [{ instrument: 'AAPL', quantity: 100 }],
        capturedAt: new Date().toISOString(),
        sourceEventType: 'PORTFOLIO_UPDATED',
      });

      const result = await harness.process([
        fakeSqsRecord('ALPACA_ACCOUNT_SNAPSHOT', {
          tenantId: 't1', portfolioId: 'p1',
          positions: [{ symbol: 'AAPL', qty: 95, marketValue: 14000 }],
        }, { tenantId: 't1', eventId: 'evt-2' }),
      ]);

      expect(putSnapshotSpy).toHaveBeenCalledWith('t1', 'Settlement', [{ instrument: 'AAPL', quantity: 95 }], 'ALPACA_ACCOUNT_SNAPSHOT');
      expect(reconcileSpy).toHaveBeenCalledWith('evt-2', expect.objectContaining({
        intentPositions: [{ instrument: 'AAPL', quantity: 100 }],
        settlementPositions: [{ instrument: 'AAPL', quantity: 95 }],
      }));
      expect(result.intents.length).toBeGreaterThanOrEqual(1);
    });

    it('should cache settlement and skip when no intent exists', async () => {
      getSnapshotSpy.mockResolvedValueOnce(null);

      await harness.process([
        fakeSqsRecord('ALPACA_ACCOUNT_SNAPSHOT', {
          tenantId: 't1',
          positions: [{ symbol: 'AAPL', qty: 50, marketValue: 7500 }],
        }, { tenantId: 't1' }),
      ]);

      expect(putSnapshotSpy).toHaveBeenCalledWith('t1', 'Settlement', [{ instrument: 'AAPL', quantity: 50 }], 'ALPACA_ACCOUNT_SNAPSHOT');
      expect(reconcileSpy).not.toHaveBeenCalled();
    });
  });

  describe('drift detection', () => {
    it('should produce ReconciliationResult + DriftRecord when drift detected', async () => {
      getSnapshotSpy.mockResolvedValueOnce({
        side: 'Settlement',
        positions: [{ instrument: 'AAPL', quantity: 90 }, { instrument: 'TSLA', quantity: 55 }],
        capturedAt: new Date().toISOString(),
        sourceEventType: 'ALPACA_ACCOUNT_SNAPSHOT',
      });

      const result = await harness.process([
        fakeSqsRecord('PORTFOLIO_UPDATED', {
          tenantId: 't1',
          positions: {
            AAPL: { symbol: 'AAPL', quantity: 100, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 155 },
            TSLA: { symbol: 'TSLA', quantity: 50, averageCostBasis: 200, totalCostBasis: 10000, lastFillPrice: 210 },
          },
        }, { tenantId: 't1', eventId: 'evt-3' }),
      ]);

      expect(result.intents).toHaveLength(3); // 1 ReconciliationResult + 2 DriftRecords
      expect(result.intents[0]).toMatchObject({
        typename: 'ReconciliationResult',
        fields: expect.objectContaining({ status: 'DRIFT_DETECTED', driftCount: 2 }),
      });
      expect(result.intents[1]).toMatchObject({
        typename: 'DriftRecord',
        fields: expect.objectContaining({ instrument: 'AAPL', intentQty: 100, settlementQty: 90, drift: 10 }),
      });
      expect(result.intents[2]).toMatchObject({
        typename: 'DriftRecord',
        fields: expect.objectContaining({ instrument: 'TSLA', intentQty: 50, settlementQty: 55, drift: -5 }),
      });
    });

    it('should produce ReconciliationResult with COMPLETED when no drift', async () => {
      getSnapshotSpy.mockResolvedValueOnce({
        side: 'Settlement',
        positions: [{ instrument: 'VTI', quantity: 100 }],
        capturedAt: new Date().toISOString(),
        sourceEventType: 'ALPACA_ACCOUNT_SNAPSHOT',
      });

      const result = await harness.process([
        fakeSqsRecord('PORTFOLIO_UPDATED', {
          tenantId: 't1',
          positions: { VTI: { symbol: 'VTI', quantity: 100, averageCostBasis: 200, totalCostBasis: 20000, lastFillPrice: 245 } },
        }, { tenantId: 't1', eventId: 'evt-4' }),
      ]);

      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        typename: 'ReconciliationResult',
        fields: expect.objectContaining({ status: 'COMPLETED', driftCount: 0 }),
      });
    });
  });

  describe('other event types', () => {
    it('should route PORTFOLIO_SNAPSHOT_IMPORTED as intent side', async () => {
      getSnapshotSpy.mockResolvedValueOnce(null);
      await harness.process([
        fakeSqsRecord('PORTFOLIO_SNAPSHOT_IMPORTED', {
          tenantId: 't1', positions: [{ symbol: 'AAPL', quantity: 100 }],
        }, { tenantId: 't1' }),
      ]);
      expect(putSnapshotSpy).toHaveBeenCalledWith('t1', 'Intent', expect.any(Array), 'PORTFOLIO_SNAPSHOT_IMPORTED');
    });

    it('should route CORPORATE_ACTION_APPLIED as intent side', async () => {
      getSnapshotSpy.mockResolvedValueOnce(null);
      await harness.process([
        fakeSqsRecord('CORPORATE_ACTION_APPLIED', {
          tenantId: 't1', positions: [{ symbol: 'AAPL', quantity: 100 }],
        }, { tenantId: 't1' }),
      ]);
      expect(putSnapshotSpy).toHaveBeenCalledWith('t1', 'Intent', expect.any(Array), 'CORPORATE_ACTION_APPLIED');
    });

    it('should skip unknown event types', async () => {
      const result = await harness.process([
        fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't1' }),
      ]);
      expect(result.skipped).toBe(1);
      expect(reconcileSpy).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should report failure when reconciliation service throws', async () => {
      getSnapshotSpy.mockResolvedValueOnce({
        side: 'Settlement',
        positions: [],
        capturedAt: new Date().toISOString(),
        sourceEventType: 'ALPACA_ACCOUNT_SNAPSHOT',
      });
      reconcileSpy.mockImplementationOnce(() => { throw new Error('Compute failure'); });

      const result = await harness.process([
        fakeSqsRecord('PORTFOLIO_UPDATED', {
          tenantId: 't1', positions: [],
        }, { tenantId: 't1' }),
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.batchItemFailures).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm nx run reconciliation-ctrl:test`

Expected: PASS — all tests green.

- [ ] **Step 3: Commit**

```bash
git add services/ledger/reconciliation-ctrl/test/event-listener.test.ts
git commit -m "test(reconciliation-ctrl): rewrite event-listener tests for cache-and-compare behavior"
```

---

## Task 4: Add `withSettlementSnapshot` fixture + write e2e scenario 13

**Files:**
- Modify: `apps/e2e-feature-tests/src/helpers/fixtures.ts`
- Modify: `apps/e2e-feature-tests/src/index.ts`
- Create: `apps/e2e-feature-tests/src/advisory/reconciliation-correction.e2e.test.ts`

- [ ] **Step 1: Add `withSettlementSnapshot` fixture**

In `apps/e2e-feature-tests/src/helpers/fixtures.ts`, add after the `withHoldings` function:

```ts
/**
 * Publishes a synthetic ALPACA_ACCOUNT_SNAPSHOT on the ledger bus targeting
 * reconciliation-ctrl. This seeds the settlement-side position cache.
 * Use with withHoldings() to set up intent-side first, then publish a
 * settlement snapshot with deliberately different quantities to trigger drift.
 */
export function withSettlementSnapshot(
  positions: Array<{ symbol: string; qty: number; marketValue: number }>,
): Fixture {
  return async (_ctx, tenant, eb, _bff) => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'reconciliation-ctrl',
      detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        portfolioId: tenant.tenantId,
        positions,
      },
    });
    return {};
  };
}
```

- [ ] **Step 2: Export the new fixture**

In `apps/e2e-feature-tests/src/index.ts`, add `withSettlementSnapshot` to the fixtures export:

```ts
export {
  applyFixtures,
  onboarded,
  funded,
  withDecision,
  withNotification,
  withHoldings,
  withSettlementSnapshot,
  type Fixture,
  type FixtureResult,
} from './helpers/fixtures';
```

- [ ] **Step 3: Write the e2e test**

Create `apps/e2e-feature-tests/src/advisory/reconciliation-correction.e2e.test.ts`:

```ts
import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  withHoldings,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';

describe('scenario 13 — reconciliation discrepancy surfaces corrective decision', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 2_000_000 }),
      withHoldings([
        { symbol: 'VTI', quantity: 50, fillPrice: 200 },
        { symbol: 'BND', quantity: 20, fillPrice: 80 },
      ]),
    ]);
  }, 240_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('ALPACA_ACCOUNT_SNAPSHOT with different quantities triggers drift → advisory decision', async () => {
    const bff = bffClient(ctx, tenant);
    const eb = new EventBridgeClient(ctx);

    // Wait for PORTFOLIO_UPDATED to propagate through ledger-ctrl CDC →
    // ledger-adpt → reconciliation-ctrl (seeds Intent cache).
    // withHoldings publishes ORDER_FILLED → ledger-ctrl reducer → PortfolioEvent →
    // CDC → PORTFOLIO_UPDATED → reconciliation-ctrl caches Intent side.
    // Give CDC chain 30 seconds to materialize.
    await new Promise((r) => setTimeout(r, 30_000));

    // TRIGGER: publish broker snapshot with DIFFERENT quantities (settlement side)
    // VTI: broker says 45 (intent says 50) → drift = +5
    // BND: broker says 25 (intent says 20) → drift = -5
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'reconciliation-ctrl',
      detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        portfolioId: tenant.tenantId,
        positions: [
          { symbol: 'VTI', qty: 45, marketValue: 9000 },
          { symbol: 'BND', qty: 25, marketValue: 2000 },
        ],
      },
    });

    // ASSERT: drift detection → PORTFOLIO_DRIFT_DETECTED → advisory-ctrl →
    // decision surfaces in getDecisionHistory
    const history = await waitForGraphQL<{
      getDecisionHistory: { items: Array<{ decisionId: string; trigger: string; status: string }>; nextCursor: string | null };
    }>(
      bff.advisory,
      `query History { getDecisionHistory(limit: 10) { items { decisionId trigger status } nextCursor } }`,
      {},
      (r) => r.getDecisionHistory.items.some((d) => d.trigger === 'PORTFOLIO_DRIFT_DETECTED'),
      { timeoutMs: 240_000, intervalMs: 5_000 },
    );

    const decision = history.getDecisionHistory.items.find((d) => d.trigger === 'PORTFOLIO_DRIFT_DETECTED');
    expect(decision).toBeDefined();
    expect(decision!.decisionId).toEqual(expect.any(String));
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/fixtures.ts apps/e2e-feature-tests/src/index.ts apps/e2e-feature-tests/src/advisory/reconciliation-correction.e2e.test.ts
git commit -m "test(e2e-feature-tests): scenario 13 — reconciliation correction with settlement snapshot fixture"
```

---

## Task 5: Deploy and run e2e scenario 13

**Files:** none (deployment + verification only)

- [ ] **Step 1: Deploy reconciliation-ctrl**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=reconciliation-ctrl`

Expected: Stack deploys successfully (no CDK changes, only Lambda code update).

- [ ] **Step 2: Run the e2e test**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern='reconciliation-correction\.e2e'`

Expected: PASS. If it fails, diagnose following the iterative e2e debugging workflow (run → diagnose → fix → redeploy → re-run).

- [ ] **Step 3: Run the full e2e suite to verify no regressions**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features`

Expected: All 18 suites PASS (17 existing + 1 new).

- [ ] **Step 4: Commit (if any runtime fixes needed)**

Only if Step 2/3 reveals issues requiring code changes.
