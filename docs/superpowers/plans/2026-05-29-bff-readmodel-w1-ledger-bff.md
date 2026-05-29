# BFF Read-Model w1 — ledger-bff Reference Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate ledger-bff's P1 read-row transforms from unconditional `project()` to version-guarded `projectVersioned()` (keyed on `lastEventSequence` as `__version`), register ledger-bff's read-model typenames in `ReadModelOwnership`, and prove the w0 primitive end-to-end against the real ledger-ctrl producer.

**Architecture:** ledger-ctrl already stamps a monotonic `lastEventSequence` and carries it inside the `snapshot` object of every `BALANCE_UPDATED`/`PORTFOLIO_UPDATED`/`LEDGER_ENTRY_RECORDED` event. ledger-bff materializes read rows from those events. We switch the four P1 typenames (`PortfolioLatest`, `Position`, `Simulation`, `SimulationPosition`) to `projectVersioned` using `snapshot.lastEventSequence` as the version, switch the append-only `SnapshotAt` row from `project()` to `record()` (P2), and add a `declare module` ownership augmentation so any lingering `project()`/`accumulate()` on a registered projection fails typecheck. We also fix the pre-existing simulated-path payload mismatch (transform read top-level `positions`/`cashBalanceCents`, but the producer only carries them inside `snapshot`).

**Tech Stack:** TypeScript, `@nestfolio/event-processor` (`projectVersioned`/`record`/`ReadModelOwnership`), `@nestfolio/test-support` (`expectStaleDrop`/`expectVersionedWrite`, `EventBridgeClient`, `AppSyncClient`), `@nestfolio/integration-testing` (`TableAssertions`), Jest + `aws-sdk-client-mock`, Nx, CDK deploy to dev sandbox.

---

## Context the executor needs (read once before starting)

**The w0 primitives are already shipped** in `libs/event-processor/src`:

- `projectVersioned(typename, fields, { version })` — `libs/event-processor/src/intents/project-versioned.ts`. Writes the **full** row guarded by `attribute_not_exists(pk) OR attribute_not_exists(#__version) OR #__version < :version`. On condition-fail (stale/duplicate) the executor returns `{ _tag: 'projectVersioned', success: true, deduplicated: true }` (dropped, **not** redriven). `version` is a required number. The static-object overload returns a `ProjectVersionedIntent`; the mapper overload returns a `HandlerFn`. **We use the static-object overload** (we compute the version number inside the transform).
- `ReadModelOwnership` registry — `libs/event-processor/src/types/ownership.ts`. Empty by default. A service opts typenames into enforcement via `declare module '@nestfolio/event-processor'`. Constraints (compile-time, literal typename only):
  - `projectVersioned`: only `Projection<'P1'>` or unregistered (rejects command-owned / P2 / P3).
  - `project` / `accumulate` / `update`: reject **any** projection.
  - `record`: rejects P1 + P3; allows P2 and command-owned (seed path).
- `expectStaleDrop` / `expectVersionedWrite` — `libs/test-support/src/fixtures/version-guard.ts`. Operate on an `IntentResult`-shaped `{ _tag, success, deduplicated }`.

**The producer (out of scope to change), `services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts`, emits:**

- `BalanceEvent` → `BALANCE_UPDATED`: `{ tenantId, streamType, cashBalanceCents, totalValueCents, snapshot: { positions, cashBalanceCents, lastEventSequence } }`
- `PortfolioEvent` → `PORTFOLIO_UPDATED`: `{ tenantId, streamType, positions, positionCount, totalValueCents, snapshot: { positions, cashBalanceCents, lastEventSequence } }`
- `LedgerEntryEvent` → `LEDGER_ENTRY_RECORDED`: `{ tenantId, streamType, lastEventSequence, snapshot: { positions, cashBalanceCents, lastEventSequence } }`

**Unified rule for this workstream: every P1 row reads both its field data AND its version from `payload.snapshot`.** This is consistent across all three transforms and matches what the producer actually emits. `snapshot.lastEventSequence` is the monotonic ledger sequence per stream (`actual` for `PortfolioLatest`/`Position`, `simulated` for `Simulation`/`SimulationPosition`).

**Typename classification for ledger-bff (final):**

| Typename | Variant | Intent | Source transform |
|---|---|---|---|
| `PortfolioLatest` | P1 | `projectVersioned` | balance-updated |
| `Position` | P1 | `projectVersioned` | portfolio-updated |
| `Simulation` | P1 | `projectVersioned` | ledger-entry-recorded (simulated) |
| `SimulationPosition` | P1 | `projectVersioned` | ledger-entry-recorded (simulated) |
| `SnapshotAt` | P2 | `record` (was `project`) | balance-updated, portfolio-updated |
| `HistoryEntry` | P2 | `record` (unchanged) | ledger-entry-recorded |
| `Checkpoint` | P2 | `record` (unchanged) | ledger-entry-recorded |

> **Note on the spec vs. the workstream:** the design spec's per-row table lists `SnapshotAt` under "projection P1". The w1 backlog deliverable overrides that to **P2** because `SnapshotAt` is append-only by timestamp (`sk = event.timestamp`, one row written once, no overwrite/version semantics). We follow the backlog. This is the correct classification; record it but do not re-litigate.

**Pre-existing latent debt (DO NOT try to fix in w1):** `tsc --noEmit` on ledger-bff `src` already reports ~18 errors (event-listener `UnitOfWork` generic variance, `portfolio.repository.ts` `timestamp` not on `TableEntry`, etc.) and the unit test files use `as Record<string, unknown>[]` casts that error under `tsc`. These predate w1 and are the same class as `investor-bff-13-latent-tsc-errors` / `ledger-ctrl-2-latent-tsc-errors`. **Because of this, a whole-service `tsc` gate is red regardless of our change.** Our enforcement gate is therefore scoped (see Task 4): the migrated `src/transforms/*` files must compile clean, and a dedicated type-test file must behave correctly. File the broader debt as a separate parking item during execution (see Task 8).

---

## File Structure

- **Modify** `services/ledger/ledger-bff/src/transforms/balance-updated.ts` — `PortfolioLatest` → `projectVersioned`; `SnapshotAt` → `record`.
- **Modify** `services/ledger/ledger-bff/src/transforms/portfolio-updated.ts` — `Position` → `projectVersioned`; `SnapshotAt` → `record`.
- **Modify** `services/ledger/ledger-bff/src/transforms/ledger-entry-recorded.ts` — `Simulation`/`SimulationPosition` → `projectVersioned` reading `snapshot.*`; `HistoryEntry`/`Checkpoint` unchanged.
- **Create** `services/ledger/ledger-bff/src/read-model-ownership.ts` — `declare module` augmentation registering all seven typenames.
- **Modify** `services/ledger/ledger-bff/src/handlers/event-listener.ts` — add side-effect import of `../read-model-ownership`.
- **Modify** `services/ledger/ledger-bff/test/unit/transforms/balance-updated.test.ts`
- **Modify** `services/ledger/ledger-bff/test/unit/transforms/portfolio-updated.test.ts`
- **Modify** `services/ledger/ledger-bff/test/unit/transforms/ledger-entry-recorded.test.ts`
- **Create** `services/ledger/ledger-bff/test/types/read-model-ownership.type-test.ts` — `@ts-expect-error` proof of enforcement.
- **Create** `services/ledger/ledger-bff/test/unit/version-guard.test.ts` — executor-level test using `expectStaleDrop`/`expectVersionedWrite` against the real ledger-bff intent.
- **Modify** `services/ledger/ledger-bff/test/integration/ledger-bff.integration.test.ts` — update simulated injection to nest under `snapshot`; add version-guard (`__version` invariance) cases.

---

## Task 1: Migrate balance-updated (PortfolioLatest → P1, SnapshotAt → P2)

**Files:**
- Modify: `services/ledger/ledger-bff/src/transforms/balance-updated.ts`
- Test: `services/ledger/ledger-bff/test/unit/transforms/balance-updated.test.ts`

- [ ] **Step 1: Update the unit test (the failing test)**

Replace the entire contents of `test/unit/transforms/balance-updated.test.ts` with:

```typescript
import { projectVersioned, record } from '@nestfolio/event-processor';
import { balanceUpdated } from '../../../src/transforms/balance-updated';

describe('balanceUpdated transform', () => {
  const makeUow = (subject: Record<string, unknown>) => ({
    event: {
      id: 'e1',
      type: 'BALANCE_UPDATED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  });

  it('writes a versioned PortfolioLatest projection keyed on snapshot.lastEventSequence', () => {
    const result = balanceUpdated(makeUow({
      cashBalanceCents: 950_000,
      deltaCents: -50_000,
      snapshot: {
        positions: { VTI: { symbol: 'VTI', quantity: 10 } },
        cashBalanceCents: 950_000,
        lastEventSequence: 7,
      },
    }) as Parameters<typeof balanceUpdated>[0]);

    const intents = (Array.isArray(result) ? result : [result]) as Array<Record<string, unknown>>;
    const latest = intents.find((i) => i.typename === 'PortfolioLatest');
    expect(latest).toMatchObject({
      _tag: 'projectVersioned',
      typename: 'PortfolioLatest',
      version: 7,
      overrides: { pk: 'Portfolio#t1', sk: 'Latest' },
    });
    expect((latest!.fields as Record<string, unknown>).cashBalanceCents).toBe(950_000);
  });

  it('writes SnapshotAt as an append-only record (P2) when snapshot is present', () => {
    const result = balanceUpdated(makeUow({
      cashBalanceCents: 950_000,
      snapshot: {
        positions: { VTI: { symbol: 'VTI', quantity: 10 } },
        cashBalanceCents: 950_000,
        lastEventSequence: 7,
      },
    }) as Parameters<typeof balanceUpdated>[0]);

    const intents = result as Array<Record<string, unknown>>;
    expect(Array.isArray(intents)).toBe(true);
    const snap = intents.find((i) => i.typename === 'SnapshotAt');
    expect(snap).toMatchObject({
      _tag: 'record',
      typename: 'SnapshotAt',
      overrides: { pk: 'SnapshotAt#t1#actual', sk: '2026-01-01T00:00:00.000Z' },
    });
  });

  it('defaults version to 0 when no snapshot present (legacy/simplified event)', () => {
    const result = balanceUpdated(makeUow({
      cashBalanceCents: 500_000,
    }) as Parameters<typeof balanceUpdated>[0]);

    const intent = result as Record<string, unknown>;
    expect(intent).toMatchObject({
      _tag: 'projectVersioned',
      typename: 'PortfolioLatest',
      version: 0,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run ledger-bff:test --testPathPatterns=balance-updated`
Expected: FAIL — current transform returns `project` intents (`_tag: 'project'`), not `projectVersioned`/`record`.

- [ ] **Step 3: Rewrite the transform**

Replace the entire contents of `src/transforms/balance-updated.ts` with:

```typescript
import { projectVersioned, record, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type BalancePayload = {
  cashBalanceCents: number;
  deltaCents: number;
  streamType?: string;
  snapshot?: {
    positions: Record<string, unknown>;
    cashBalanceCents: number;
    lastEventSequence: number;
  };
};

export const balanceUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = event.subject as BalancePayload & Record<string, unknown>;

  const balanceCents = payload.cashBalanceCents ?? 0;
  const version = Number(payload.snapshot?.lastEventSequence ?? 0);

  const intents: WriteIntent[] = [
    projectVersioned('PortfolioLatest', {
      tenantId,
      userId,
      region,
      cashBalanceCents: balanceCents,
    }, {
      version,
      overrides: { pk: `Portfolio#${tenantId}`, sk: 'Latest' },
    }),
  ];

  if (payload.snapshot) {
    const streamType = payload.streamType ?? 'actual';
    intents.push(
      record('SnapshotAt', {
        tenantId,
        userId,
        region,
        streamType,
        snapshotAt: event.timestamp,
        cashBalanceCents: payload.snapshot.cashBalanceCents,
        positions: payload.snapshot.positions,
      }, {
        pk: `SnapshotAt#${tenantId}#${streamType}`,
        sk: event.timestamp,
      }),
    );
  }

  return intents.length === 1 ? intents[0] : intents;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run ledger-bff:test --testPathPatterns=balance-updated`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-bff/src/transforms/balance-updated.ts services/ledger/ledger-bff/test/unit/transforms/balance-updated.test.ts
git commit -m "refactor(ledger-bff): balance-updated → projectVersioned(PortfolioLatest) + record(SnapshotAt)"
```

---

## Task 2: Migrate portfolio-updated (Position → P1, SnapshotAt → P2)

**Files:**
- Modify: `services/ledger/ledger-bff/src/transforms/portfolio-updated.ts`
- Test: `services/ledger/ledger-bff/test/unit/transforms/portfolio-updated.test.ts`

- [ ] **Step 1: Update the unit test (the failing test)**

Replace the entire contents of `test/unit/transforms/portfolio-updated.test.ts` with:

```typescript
import { projectVersioned, record } from '@nestfolio/event-processor';
import { portfolioUpdated } from '../../../src/transforms/portfolio-updated';

describe('portfolioUpdated transform', () => {
  const makeUow = (subject: Record<string, unknown>) => ({
    event: {
      id: 'e1',
      type: 'PORTFOLIO_UPDATED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  });

  const pos = (symbol: string) => ({
    symbol, quantity: 10, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 155,
  });

  it('writes versioned Position projections keyed on snapshot.lastEventSequence', () => {
    const result = portfolioUpdated(makeUow({
      positions: { AAPL: pos('AAPL'), MSFT: pos('MSFT') },
      snapshot: { positions: {}, cashBalanceCents: 0, lastEventSequence: 12 },
    }) as Parameters<typeof portfolioUpdated>[0]);

    const intents = result as Array<Record<string, unknown>>;
    const positions = intents.filter((i) => i.typename === 'Position');
    expect(positions).toHaveLength(2);
    for (const p of positions) {
      expect(p._tag).toBe('projectVersioned');
      expect(p.version).toBe(12);
    }
    const aapl = positions.find((p) => (p.overrides as Record<string, string>).sk === 'Position#AAPL');
    expect(aapl).toMatchObject({ overrides: { pk: 'Portfolio#t1', sk: 'Position#AAPL' } });
    expect((aapl!.fields as Record<string, unknown>).quantity).toBe(10);
  });

  it('writes SnapshotAt as an append-only record (P2) when snapshot is present', () => {
    const result = portfolioUpdated(makeUow({
      positions: { AAPL: pos('AAPL') },
      snapshot: { positions: {}, cashBalanceCents: 0, lastEventSequence: 12 },
    }) as Parameters<typeof portfolioUpdated>[0]);

    const intents = result as Array<Record<string, unknown>>;
    const snap = intents.find((i) => i.typename === 'SnapshotAt');
    expect(snap).toMatchObject({
      _tag: 'record',
      typename: 'SnapshotAt',
      overrides: { pk: 'SnapshotAt#t1#actual', sk: '2026-01-01T00:00:00.000Z' },
    });
  });

  it('defaults version to 0 when no snapshot present', () => {
    const result = portfolioUpdated(makeUow({
      positions: { AAPL: pos('AAPL') },
    }) as Parameters<typeof portfolioUpdated>[0]);

    const intent = result as Record<string, unknown>;
    expect(intent).toMatchObject({ _tag: 'projectVersioned', typename: 'Position', version: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run ledger-bff:test --testPathPatterns=portfolio-updated`
Expected: FAIL — transform still returns `project` intents.

- [ ] **Step 3: Rewrite the transform**

Replace the entire contents of `src/transforms/portfolio-updated.ts` with:

```typescript
import { projectVersioned, record, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type PositionRecord = {
  symbol: string;
  quantity: number;
  averageCostBasis: number;
  totalCostBasis: number;
  lastFillPrice: number;
};

type PortfolioPayload = {
  positions: Record<string, PositionRecord>;
  streamType?: string;
  snapshot?: {
    positions: Record<string, PositionRecord>;
    cashBalanceCents: number;
    lastEventSequence: number;
  };
};

export const portfolioUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = event.subject as PortfolioPayload & Record<string, unknown>;

  const positions = payload.positions ?? {};
  const version = Number(payload.snapshot?.lastEventSequence ?? 0);
  const intents: WriteIntent[] = [];

  for (const [symbol, position] of Object.entries(positions)) {
    intents.push(
      projectVersioned('Position', {
        tenantId,
        userId,
        region,
        symbol,
        quantity: position.quantity ?? 0,
        averageCostBasis: position.averageCostBasis ?? 0,
        totalCostBasis: position.totalCostBasis ?? 0,
        lastFillPrice: position.lastFillPrice ?? 0,
      }, {
        version,
        overrides: { pk: `Portfolio#${tenantId}`, sk: `Position#${symbol}` },
      }),
    );
  }

  if (payload.snapshot) {
    const streamType = payload.streamType ?? 'actual';
    intents.push(
      record('SnapshotAt', {
        tenantId,
        userId,
        region,
        streamType,
        snapshotAt: event.timestamp,
        cashBalanceCents: payload.snapshot.cashBalanceCents,
        positions: payload.snapshot.positions,
      }, {
        pk: `SnapshotAt#${tenantId}#${streamType}`,
        sk: event.timestamp,
      }),
    );
  }

  return intents.length === 1 ? intents[0] : intents;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run ledger-bff:test --testPathPatterns=portfolio-updated`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-bff/src/transforms/portfolio-updated.ts services/ledger/ledger-bff/test/unit/transforms/portfolio-updated.test.ts
git commit -m "refactor(ledger-bff): portfolio-updated → projectVersioned(Position) + record(SnapshotAt)"
```

---

## Task 3: Migrate ledger-entry-recorded (Simulation/SimulationPosition → P1, fix snapshot mismatch)

The simulated branch currently reads top-level `payload.positions`/`payload.cashBalanceCents`, which the real producer does **not** emit (it only carries them inside `snapshot`). We fix that here AND switch to `projectVersioned`. `HistoryEntry` and `Checkpoint` (P2 `record`) are unchanged.

**Files:**
- Modify: `services/ledger/ledger-bff/src/transforms/ledger-entry-recorded.ts`
- Test: `services/ledger/ledger-bff/test/unit/transforms/ledger-entry-recorded.test.ts`

- [ ] **Step 1: Update the unit test (the failing test)**

Replace the entire contents of `test/unit/transforms/ledger-entry-recorded.test.ts` with:

```typescript
import { record, projectVersioned } from '@nestfolio/event-processor';
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

  it('writes a HistoryEntry record (P2) for an actual-stream entry', () => {
    const result = ledgerEntryRecorded(makeUow({
      eventId: 'evt-1',
      eventType: 'ORDER_FILLED',
      payload: { orderId: 'o1' },
      timestamp: '2026-01-01T00:00:00.000Z',
      sequenceNo: 42,
    }) as Parameters<typeof ledgerEntryRecorded>[0]);

    const intent = result as Record<string, unknown>;
    expect(intent).toMatchObject({
      _tag: 'record',
      typename: 'HistoryEntry',
      overrides: { pk: 'History#t1', sk: 'Entry#42' },
    });
  });

  it('writes versioned Simulation + SimulationPosition from snapshot for a simulated entry', () => {
    const result = ledgerEntryRecorded(makeUow({
      eventId: 'evt-sim',
      eventType: 'SIMULATED_TRADE',
      payload: {},
      timestamp: '2026-01-01T00:00:00.000Z',
      sequenceNo: 5,
      streamType: 'simulated',
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
  });

  it('writes a Checkpoint record (P2) when sequenceNo is a multiple of 100', () => {
    const result = ledgerEntryRecorded(makeUow({
      eventId: 'evt-cp',
      eventType: 'CHECKPOINT',
      payload: {},
      timestamp: '2026-01-15T00:00:00.000Z',
      sequenceNo: 200,
    }) as Parameters<typeof ledgerEntryRecorded>[0]);

    const intents = result as Array<Record<string, unknown>>;
    const cp = intents.find((i) => i.typename === 'Checkpoint');
    expect(cp).toMatchObject({
      _tag: 'record',
      typename: 'Checkpoint',
      overrides: { pk: 'Checkpoint#t1', sk: '2026-01-15' },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run ledger-bff:test --testPathPatterns=ledger-entry-recorded`
Expected: FAIL — simulated branch still uses `project` and reads top-level `positions`.

- [ ] **Step 3: Rewrite the transform**

Replace the entire contents of `src/transforms/ledger-entry-recorded.ts` with:

```typescript
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
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp: string;
  sequenceNo: number;
  streamType?: string;
  snapshot?: {
    positions: Record<string, PositionRecord>;
    cashBalanceCents: number;
    lastEventSequence: number;
  };
};

const CHECKPOINT_INTERVAL = 100;

export const ledgerEntryRecorded = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = event.subject as LedgerEntryPayload & Record<string, unknown>;

  const intents: WriteIntent[] = [
    record('HistoryEntry', {
      tenantId,
      userId,
      region,
      eventId: payload.eventId,
      eventType: payload.eventType,
      payload: payload.payload ?? {},
      createdAt: payload.timestamp,
      sequenceNo: payload.sequenceNo,
      streamType: payload.streamType,
    }, {
      pk: `History#${tenantId}`,
      sk: `Entry#${payload.sequenceNo}`,
    }),
  ];

  // Simulated stream: version-guarded projections fed from the snapshot.
  if (payload.streamType === 'simulated') {
    const snapshot = payload.snapshot;
    const cashBalanceCents = snapshot?.cashBalanceCents ?? 0;
    const positions = snapshot?.positions ?? {};
    const version = Number(snapshot?.lastEventSequence ?? 0);

    intents.push(
      projectVersioned('Simulation', {
        tenantId,
        userId,
        region,
        cashBalanceCents,
        positions,
      }, {
        version,
        overrides: { pk: `Simulation#${tenantId}`, sk: 'Latest' },
      }),
    );

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
          version,
          overrides: { pk: `Simulation#${tenantId}`, sk: `Position#${symbol}` },
        }),
      );
    }
  }

  // Checkpoint every N entries (append-only).
  if (payload.sequenceNo > 0 && payload.sequenceNo % CHECKPOINT_INTERVAL === 0) {
    const date = payload.timestamp.slice(0, 10);
    intents.push(
      record('Checkpoint', {
        tenantId,
        userId,
        region,
        date,
        cashBalanceCents: payload.snapshot?.cashBalanceCents ?? 0,
        positions: payload.snapshot?.positions ?? {},
      }, {
        pk: `Checkpoint#${tenantId}`,
        sk: date,
      }),
    );
  }

  return intents.length === 1 ? intents[0] : intents;
};
```

> Note: the `Checkpoint` body now also reads `snapshot.*` (was top-level `payload.cashBalanceCents`/`payload.positions`, which the producer never emits) — this is the same mismatch fix applied consistently. `Checkpoint` stays a P2 `record`; only its field source changes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run ledger-bff:test --testPathPatterns=ledger-entry-recorded`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-bff/src/transforms/ledger-entry-recorded.ts services/ledger/ledger-bff/test/unit/transforms/ledger-entry-recorded.test.ts
git commit -m "refactor(ledger-bff): ledger-entry-recorded → projectVersioned(Simulation*) from snapshot"
```

---

## Task 4: Register ReadModelOwnership + prove enforcement (compile-time)

**Files:**
- Create: `services/ledger/ledger-bff/src/read-model-ownership.ts`
- Modify: `services/ledger/ledger-bff/src/handlers/event-listener.ts`
- Create: `services/ledger/ledger-bff/test/types/read-model-ownership.type-test.ts`

- [ ] **Step 1: Create the ownership augmentation**

Create `src/read-model-ownership.ts`:

```typescript
/**
 * ledger-bff read-model ownership registration.
 *
 * Opting these typenames into @nestfolio/event-processor's ReadModelOwnership
 * registry turns on compile-time enforcement:
 *   - P1 rows may ONLY be written via projectVersioned() (project/accumulate/update
 *     on them fail typecheck).
 *   - P2 append-logs may ONLY be written via record().
 * See docs/architecture/READ-MODEL-OWNERSHIP.md for the model.
 */
import type { Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    // P1 — versioned snapshots fed by ledger-ctrl's monotonic lastEventSequence.
    PortfolioLatest: Projection<'P1'>;
    Position: Projection<'P1'>;
    Simulation: Projection<'P1'>;
    SimulationPosition: Projection<'P1'>;
    // P2 — append-only logs (idempotent, order-independent).
    SnapshotAt: Projection<'P2'>;
    HistoryEntry: Projection<'P2'>;
    Checkpoint: Projection<'P2'>;
  }
}

export {};
```

- [ ] **Step 2: Wire the augmentation into the compilation via a side-effect import**

In `src/handlers/event-listener.ts`, add the import as the first line (above the existing `@nestfolio/event-processor` import):

```typescript
import '../read-model-ownership';
import { materializeToTable, toUow, type EventPayload, type EventContext } from '@nestfolio/event-processor';
```

(The `declare module` augmentation is global once the module is part of the program; the explicit side-effect import guarantees inclusion and documents the dependency.)

- [ ] **Step 3: Verify the migrated transforms still compile clean**

Run:
```bash
pnpm nx run ledger-bff:lint
npx tsc --noEmit -p services/ledger/ledger-bff/tsconfig.json 2>&1 | grep "src/transforms/" || echo "TRANSFORMS CLEAN"
```
Expected: `TRANSFORMS CLEAN` (no `src/transforms/*` errors). If a `project()`/`accumulate()` on a registered typename slipped through, this prints the offending file:line — fix it before continuing. (The unrelated ~18 pre-existing `src` errors in `event-listener.ts`/`portfolio.repository.ts` and the test-cast errors remain; they are out of scope — do not fix them here.)

- [ ] **Step 4: Create the type-test that proves enforcement fires**

Create `test/types/read-model-ownership.type-test.ts`:

```typescript
/**
 * Compile-time proof that ledger-bff's ownership registration rejects the wrong
 * write intents. A `@ts-expect-error` that does NOT error is itself a compile
 * failure. Verified by tsc (see Step 5) — no runtime assertions.
 */
import { project, accumulate, update, record, projectVersioned } from '@nestfolio/event-processor';
import '../../src/read-model-ownership';

// P1 rows: projectVersioned is the only blessed write.
projectVersioned('PortfolioLatest', { a: 1 }, { version: 1 });
projectVersioned('Position', { a: 1 }, { version: 1 });
projectVersioned('Simulation', { a: 1 }, { version: 1 });
projectVersioned('SimulationPosition', { a: 1 }, { version: 1 });

// @ts-expect-error — unconditional project on a P1 projection must not typecheck
project('PortfolioLatest', { a: 1 });
// @ts-expect-error — accumulate on a P1 projection must not typecheck
accumulate('Position', { field: 'count', increment: 1 });
// @ts-expect-error — command update on a P1 projection must not typecheck
update('Simulation', { a: 1 });
// @ts-expect-error — record (append) on a P1 projection must not typecheck
record('SimulationPosition', { a: 1 });

// P2 append-logs: record is the blessed write; projectVersioned is rejected.
record('SnapshotAt', { a: 1 });
record('HistoryEntry', { a: 1 });
record('Checkpoint', { a: 1 });

// @ts-expect-error — projectVersioned on a P2 append-log must not typecheck
projectVersioned('SnapshotAt', { a: 1 }, { version: 1 });
// @ts-expect-error — project on a P2 projection must not typecheck
project('HistoryEntry', { a: 1 });

export {};
```

- [ ] **Step 5: Run tsc against the type-test and confirm it produces ZERO errors**

Run:
```bash
npx tsc --noEmit -p services/ledger/ledger-bff/tsconfig.json 2>&1 | grep "test/types/read-model-ownership" || echo "TYPE-TEST CLEAN"
```
Expected: `TYPE-TEST CLEAN`. Any output here means either a `@ts-expect-error` did not fire (enforcement broken) or a blessed call was wrongly rejected (registration wrong). Both are failures — fix before continuing.

> If the type-test file is not picked up by `tsconfig.json` (it may be excluded from the default `include`), confirm it compiles via `tsconfig.spec.json` instead: `npx tsc --noEmit -p services/ledger/ledger-bff/tsconfig.spec.json 2>&1 | grep "test/types/read-model-ownership" || echo "TYPE-TEST CLEAN"`. Use whichever tsconfig actually includes `test/**`.

- [ ] **Step 6: Run the full ledger-bff unit suite**

Run: `pnpm nx run ledger-bff:test`
Expected: PASS — all transform tests + existing suite green.

- [ ] **Step 7: Commit**

```bash
git add services/ledger/ledger-bff/src/read-model-ownership.ts services/ledger/ledger-bff/src/handlers/event-listener.ts services/ledger/ledger-bff/test/types/read-model-ownership.type-test.ts
git commit -m "feat(ledger-bff): register ReadModelOwnership P1/P2 typenames + compile-time enforcement type-test"
```

---

## Task 5: Executor-level version-guard test (uses test-support helpers)

This honors the backlog deliverable "integration tests asserting version-guard behaviour … using `expectStaleDrop`/`expectVersionedWrite`" at the layer where those helpers actually apply: an `IntentResult`. We feed the **real** intent produced by `balanceUpdated` through the `IntentExecutor` against a mocked DynamoDB and assert fresh-write vs stale-drop.

**Files:**
- Create: `services/ledger/ledger-bff/test/unit/version-guard.test.ts`

- [ ] **Step 1: Write the test**

Create `test/unit/version-guard.test.ts`:

```typescript
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { IntentExecutor } from '@nestfolio/event-processor';
import { expectVersionedWrite, expectStaleDrop } from '@nestfolio/test-support';
import { balanceUpdated } from '../../src/transforms/balance-updated';

const ddbMock = mockClient(DynamoDBDocumentClient);
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const makeUow = (lastEventSequence: number) => ({
  event: {
    id: 'e1',
    type: 'BALANCE_UPDATED',
    timestamp: '2026-01-01T00:00:00.000Z',
    subject: {
      cashBalanceCents: 500_000,
      snapshot: { positions: {}, cashBalanceCents: 500_000, lastEventSequence },
    },
    context: { tenantId: 't1' },
  },
  payload: {},
  record: {},
});

const fakeCtx = {
  eventId: 'evt-1',
  eventType: 'BALANCE_UPDATED',
  tenantId: 't1',
  timestamp: '2026-01-01T00:00:00.000Z',
  receiveCount: 1,
  serviceName: 'ledger-bff',
} as never;

// Pull the PortfolioLatest projectVersioned intent out of the transform output.
const portfolioLatestIntent = (lastEventSequence: number) => {
  const out = balanceUpdated(makeUow(lastEventSequence) as Parameters<typeof balanceUpdated>[0]);
  const intents = Array.isArray(out) ? out : [out];
  const intent = intents.find((i) => (i as { typename?: string }).typename === 'PortfolioLatest');
  if (!intent) throw new Error('expected a PortfolioLatest intent');
  return intent;
};

describe('ledger-bff PortfolioLatest version guard', () => {
  let executor: IntentExecutor;

  beforeEach(() => {
    ddbMock.reset();
    executor = new IntentExecutor({ docClient, tableName: 'TestTable' });
  });

  it('applies a fresh versioned write when the condition succeeds', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    const result = await executor.execute(portfolioLatestIntent(10), fakeCtx);
    expectVersionedWrite(result);
  });

  it('drops a stale write when the version condition fails', async () => {
    const err = new Error('stale');
    err.name = 'ConditionalCheckFailedException';
    ddbMock.on(UpdateCommand).rejects(err);
    const result = await executor.execute(portfolioLatestIntent(3), fakeCtx);
    expectStaleDrop(result);
  });
});
```

- [ ] **Step 2: Confirm `IntentExecutor` is exported from the event-processor index**

Run: `grep -n "IntentExecutor" libs/event-processor/src/index.ts`
Expected: a matching `export` line. If `IntentExecutor` is NOT exported from the package root, import it via the deep path instead — change the import in the test to:
`import { IntentExecutor } from '@nestfolio/event-processor/engine/intent-executor';`
and re-run. (Do not add a new export to the event-processor barrel — that is a shared-lib surface change outside w1 scope.)

- [ ] **Step 3: Run the test to verify it passes**

Run: `pnpm nx run ledger-bff:test --testPathPatterns=version-guard`
Expected: PASS (2 tests). `expectVersionedWrite` sees `{ _tag: 'projectVersioned', success: true }`; `expectStaleDrop` sees `{ _tag: 'projectVersioned', success: true, deduplicated: true }`.

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-bff/test/unit/version-guard.test.ts
git commit -m "test(ledger-bff): executor-level version-guard test using expectStaleDrop/expectVersionedWrite"
```

---

## Task 6: Integration version-guard + fix simulated injection

The deployed-Lambda integration test asserts version-guard behaviour by reading the materialized `__version` and field values (the helpers from Task 5 do not apply here — there is no `IntentResult` over EventBridge). It also fixes the existing simulated injection to match the producer's `snapshot`-nested shape (required by the Task 3 transform change).

**Files:**
- Modify: `services/ledger/ledger-bff/test/integration/ledger-bff.integration.test.ts`

- [ ] **Step 1: Fix the existing simulated injection (step 5 of the getSimulationComparison flow)**

Find the `LEDGER_ENTRY_RECORDED` injection with `streamType: 'simulated'` (around line 250). Replace its top-level `cashBalanceCents` + `positions` with a nested `snapshot`, keeping `streamType` top-level:

```typescript
      // 5. LEDGER_ENTRY_RECORDED with streamType: 'simulated' → Simulation#Latest + SimulationPosition
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        detail: {
          eventId: 'integ-sim-001',
          eventType: 'SIMULATED_TRADE',
          payload: {},
          timestamp: new Date().toISOString(),
          sequenceNo: 1,
          streamType: 'simulated',
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

- [ ] **Step 2: Add `snapshot.lastEventSequence` to the existing actual-stream injections that assert Position/PortfolioLatest**

The `BALANCE_UPDATED` and `PORTFOLIO_UPDATED` injections in the happy-path tests write to fresh pk/sk (first write always succeeds via `attribute_not_exists`), so they still pass with version 0. To keep them realistic and self-documenting, add a `snapshot` with a `lastEventSequence` to each. Example for the `BALANCE_UPDATED` "materialize" test (around line 47):

```typescript
        detail: {
          cashBalanceCents: 500000,
          deltaCents: 50000,
          snapshot: { positions: {}, cashBalanceCents: 500000, lastEventSequence: 1 },
        },
```

And for the `PORTFOLIO_UPDATED` "materialize" test (around line 73), add after `positions: { ... }`:

```typescript
          snapshot: { positions: {}, cashBalanceCents: 0, lastEventSequence: 1 },
```

- [ ] **Step 3: Add a new version-guard describe block**

Add this block inside the top-level `describe('ledger-bff', ...)`, after the `event materializations` describe:

```typescript
  // ── Version guard (P1 projection) ───────────────────────────────────
  //
  // projectVersioned drops stale/duplicate deliveries (no clobber). We assert
  // the materialized __version never regresses and the stale event's field
  // value never wins.
  describe('version guard', () => {
    it('keeps the newest version and drops a stale BALANCE_UPDATED', async () => {
      const pk = `Portfolio#${ctx.tenantId}`;

      // Fresh write at version 20.
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'BALANCE_UPDATED',
        detail: {
          cashBalanceCents: 2_000_000,
          snapshot: { positions: {}, cashBalanceCents: 2_000_000, lastEventSequence: 20 },
        },
      });
      const fresh = await table.waitForItem({ table: 'ledger-bff', pk, sk: 'Latest', timeoutMs: 60_000 });
      expect(fresh['__version']).toBe(20);
      expect(fresh['cashBalanceCents']).toBe(2_000_000);

      // Stale write at version 10 — must be dropped, not applied.
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'BALANCE_UPDATED',
        detail: {
          cashBalanceCents: 111,
          snapshot: { positions: {}, cashBalanceCents: 111, lastEventSequence: 10 },
        },
      });

      // Settle window: poll for ~16s asserting the row never regresses to the stale value.
      for (let i = 0; i < 8; i++) {
        const item = await table.waitForItem({ table: 'ledger-bff', pk, sk: 'Latest', timeoutMs: 30_000 });
        expect(item['__version']).toBe(20);
        expect(item['cashBalanceCents']).toBe(2_000_000);
        await new Promise((r) => setTimeout(r, 2_000));
      }

      // A newer write at version 30 IS applied.
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'BALANCE_UPDATED',
        detail: {
          cashBalanceCents: 3_000_000,
          snapshot: { positions: {}, cashBalanceCents: 3_000_000, lastEventSequence: 30 },
        },
      });
      await table.waitForCondition({
        table: 'ledger-bff',
        pk,
        sk: 'Latest',
        predicate: (item) => item['__version'] === 30 && item['cashBalanceCents'] === 3_000_000,
        timeoutMs: 60_000,
      });
    }, 180_000);
  });
```

- [ ] **Step 4: Confirm the `TableAssertions` API used above exists**

Run: `grep -n "waitForItem\|waitForCondition\|predicate" libs/integration-testing/src/**/*.ts | head`
Expected: `waitForItem` exists (used throughout this test already). If `waitForCondition` (or a `predicate`-style poll) does NOT exist, replace the final "version 30 IS applied" assertion with a `waitForItem` + explicit field check loop modeled on the settle-window code above (poll `waitForItem`, break when `__version === 30`). Do NOT add new helpers to `integration-testing` (shared-lib surface change, out of scope).

- [ ] **Step 5: Lint the test file**

Run: `pnpm nx run ledger-bff:lint`
Expected: PASS. (Integration tests are not executed until deploy in Task 7 — they run against the deployed Lambda.)

- [ ] **Step 6: Commit**

```bash
git add services/ledger/ledger-bff/test/integration/ledger-bff.integration.test.ts
git commit -m "test(ledger-bff): integration version-guard cases + fix simulated injection to snapshot shape"
```

---

## Task 7: Deploy to dev + scoped validation (closing-phase gate)

> This task is the workstream's done-definition gate and maps to `/backlog-next` closing-phase steps 6.2–6.4. Dev-account operations are pre-authorized (no confirmation needed).

- [ ] **Step 1: Affected unit + lint gate**

Run: `pnpm nx affected -t test,lint --base=origin/main`
Expected: PASS. Must be green before deploy.

- [ ] **Step 2: Deploy ledger-bff to dev**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=ledger-bff 2>&1 | tee /tmp/w1-ledger-bff-deploy.log`
Expected: stack update completes. Capture the deploy log tail for the validation gate.

- [ ] **Step 3: Run the ledger-bff integration suite against deployed dev**

Run: `pnpm nx run ledger-bff:test-integration`
Expected: PASS — including the new `version guard` describe block and the (now snapshot-shaped) simulated materialization. If a version-guard assertion flakes, pull CloudWatch evidence from the failing window and re-run a confirmation pass (a flake is a real failure — see `feedback_flake_means_broken`).

- [ ] **Step 4: Run the involved e2e scenario(s)**

ledger-bff feeds the portfolio/holdings read models surfaced after a fill. Run only the involved `apps/e2e-feature-tests` scenario(s) — the ledger/portfolio materialization path (e.g. the new-investor or portfolio scenario that asserts balance/positions). Identify the scenario file under `apps/e2e-feature-tests` that exercises ledger read rows and run it scoped:

```bash
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev \
  pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns=<ledger-or-portfolio-scenario>
```
Expected: PASS. **NEVER the full e2e suite. NEVER Playwright.** Pick the scenario that asserts portfolio balance / positions after a fill.

- [ ] **Step 5: Record evidence for the validation gate**

Collect: the squash/commit SHAs of Tasks 1–6, the deploy log line confirming the ledger-bff update, and the integration + e2e PASS summaries. These fill `validation_gate:` in the backlog file at closing-phase step 6.5.

---

## Task 8: File the orthogonal latent-tsc debt (file-and-continue)

During Task 4 we observed ~18 pre-existing `tsc --noEmit` errors in ledger-bff `src` (event-listener `UnitOfWork` generic variance; `portfolio.repository.ts` `timestamp` not on `TableEntry`) plus the `as Record<string, unknown>[]` casts in legacy test files. These are out of scope for w1 and block a future clean service-wide `typecheck` target.

- [ ] **Step 1: File a parking backlog item**

Invoke the `backlog-add` skill to create `docs/backlog/ledger-bff-latent-tsc-errors.md` (type: bug, status: parking) describing the ~18 latent `tsc --noEmit` src errors + test-cast errors, sibling to `investor-bff-13-latent-tsc-errors` and `ledger-ctrl-2-latent-tsc-errors`. State briefly in chat what was filed and continue. Do NOT fix them in w1.

---

## Out of scope (mirrors backlog frontmatter)

- Any BFF other than ledger-bff (dashboard/advisory/investor are w2–w5).
- Changing ledger-ctrl's producer side — it already stamps `lastEventSequence`; w1 only consumes it.
- Externally-settled-entity ownership (Deposit/Withdrawal/Order) — w5.
- Live-push transport for ledger read rows — deferred `dashboard-live-push-*` family.
- Governance/freeze enforcement layers 3+4 (skills + audits) — w6.
- `AdvisoryStatus` P3 re-sourcing — w2/w3.
- Fixing the ~18 pre-existing ledger-bff latent `tsc` errors (filed in Task 8).
- Adding new exports/helpers to `@nestfolio/event-processor` or `@nestfolio/integration-testing` barrels (shared-lib surface changes).

---

## Self-Review

**Spec coverage** (against w1 backlog deliverables):
- "Switch P1 read-row transforms from `project()` to `projectVersioned()`, carrying `lastEventSequence` as `__version`" → Tasks 1, 2, 3 (all four P1 typenames; version = `snapshot.lastEventSequence`). ✓
- "Register ledger-bff's P1 typenames in `ReadModelOwnership` … any lingering `project()`/`accumulate()` fails typecheck" → Task 4 (P1 + P2 registered; type-test proves rejection; transforms verified clean). ✓
- "Keep append-only rows (snapshot history / `SnapshotAt`) as P2 `record()`" → Tasks 1, 2 (`SnapshotAt` project→record); `HistoryEntry`/`Checkpoint` remain record. ✓
- "Integration tests asserting version-guard behaviour: stale/duplicate dropped, out-of-order rejected — using `@nestfolio/test-support` `expectStaleDrop`/`expectVersionedWrite`" → Task 5 (executor-level, uses the helpers) + Task 6 (deployed-integration `__version` invariance). The helpers apply at the executor layer where an `IntentResult` exists; the deployed layer asserts via `__version` read-back. ✓
- "Done: deploy to dev + scoped ledger e2e green. No other BFF touched." → Task 7. ✓
- User decision "Migrate all 4 + fix mismatch" → Task 3 fixes the simulated `snapshot.*` read; all four P1 typenames migrated. ✓

**Placeholder scan:** every code step contains complete code; every command has an expected result. Two steps include explicit fallbacks (Task 5 Step 2 deep-import; Task 6 Step 4 `waitForCondition` absence) rather than assumptions, because those depend on barrel-export/helper details the executor must confirm at the call site. No "TBD"/"add error handling"/"similar to" placeholders.

**Type consistency:** `projectVersioned(typename, fields, { version, overrides })` signature is used identically in Tasks 1–3 and matches `libs/event-processor/src/intents/project-versioned.ts`. `record(typename, fields, overrides)` matches existing usage. `Projection<'P1'|'P2'>` and the `ReadModelOwnership` augmentation match `libs/event-processor/src/types/ownership.ts`. `expectStaleDrop`/`expectVersionedWrite` operate on `{ _tag, success, deduplicated }` per `libs/test-support/src/fixtures/version-guard.ts`, which is exactly what the executor returns for `projectVersioned`. `__version` is the reserved attribute the executor writes (`intent-executor.ts` line 103). Consistent throughout.
