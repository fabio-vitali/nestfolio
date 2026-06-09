# Typed-Subject Contracts — Ledger (slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Ledger-domain producer aggregate (ledger-ctrl + reconciliation-ctrl) a producer-owned zod subject contract that types both the persisted row (`TableEntry<Subject>`) and the emitted event (`BusEvent<Subject>`), validated against the REAL deployed emission.

**Architecture:** Pure-aggregate zod schemas live in each producer's `domain/contracts.ts` (imports ONLY zod). Rows become `TableEntry<Subject, S>` with the context generic `S` carrying identity (`RequestContext`, or a narrower `{tenantId}` for tax lots) — no hand-rolled `pk/sk/__typename` interfaces. The CDC publisher emits the whole row as the subject, so the persisted DDB row IS the emitted subject; a scoped e2e parses real deployed rows with each contract to kill the schema-co-wrong-with-fixture risk. Failure events use ONE shared platform `ErrorEventSubjectSchema` in `libs/event-processor`. Behavior is preserved — this is a typing refactor (no wire field renames).

**Tech Stack:** TypeScript, zod, `@nestfolio/event-processor` (`TableEntry<T,S>`, `BusEvent<T,S>`, `record()`, `RequestContext`, `SubjectContext`), Nx, Jest, AWS SDK v3 (DynamoDB), `@nestfolio/test-support`.

---

## Design decisions (locked by user, 2026-06-09)

1. **Validation gate (Q1):** a focused e2e in `apps/e2e-feature-tests` drives real fixtures, reads the real persisted DDB row back (`DynamoDBDocumentClient` + `ctx.ssm.tableName(svc)`), and runs `ContractSchema.parse(realRow)` — asserting declared fields present + correctly typed against REAL deployed output. Keep GraphQL where a read model already surfaces the data.
2. **Cross-domain re-export (Q2):** DEFERRED to WS-3. This slice does NOT touch `ledger-adpt/domain` or any cross-domain consumer. Intra-domain consumers (when WS-3 converts them) import `@nestfolio/<svc>/contracts` directly.
3. **Failure events (Q3):** ONE shared `ErrorEventSubjectSchema` in `libs/event-processor` (the error-event-publisher's home), referenced — not duplicated — for ledger's 2 failure events.

## Conventions applied (from the umbrella design)

- **Pure aggregates:** subjects model business fields only; identity (`tenantId`/`userId`/`region`) lives in the context `S`, never on the subject.
- **One subject type for row + event:** the row is `TableEntry<Subject>`, the event is `BusEvent<Subject>`.
- **Clean names, no `Subject` suffix:** `<Name>Schema` + `type <Name>`. The persisted-row alias, when named, is `<Name>Entry = TableEntry<<Name>, S>` (the subject keeps the clean concept name).
- **Context generic `S` carried on both** row and event.

## Out of scope

- WS-2 (publisher retyping) and WS-3 (consumer `parseSubject` conversion) — including the redundant-`tenantId`-in-`record()`-payload cleanup, which is a publisher/emission concern.
- The other three domain slices; the enforcement capstone; the `ledger-adpt/domain` cross-domain re-export.
- Runtime/behavioral changes to emitted event or context payloads (no wire field renames). `createdAt` additions to `TaxLot`/`AccountSnapshot` rows are additive, internal-row-only, and required by `TableEntry`.
- Deleting the dead `reconciliation.repository.ts` `create*` methods (file-and-continue as a side-finding; not contract work).

---

## File map

**Create:**
- `services/ledger/reconciliation-ctrl/src/domain/contracts.ts` — new producer contracts (imports ONLY zod).
- `apps/e2e-feature-tests/src/ledger/ledger-contract-emission.e2e.test.ts` — the validation gate.
- `apps/e2e-feature-tests/src/helpers/contract-assert.ts` — reusable `expectContractMatch` helper.
- `libs/event-processor/test/error-event-subject-schema.test.ts` — unit test for the shared schema.
- `services/ledger/ledger-ctrl/test/domain/contracts.test.ts` — unit tests for the new ledger schemas (if a contracts test does not already exist).
- `services/ledger/reconciliation-ctrl/test/domain/contracts.test.ts` — unit tests for the reconciliation schemas.

**Modify:**
- `libs/event-processor/src/domain/schemas.ts` — add `ErrorEventSubjectSchema` + `ErrorEventSubject`.
- `libs/event-processor/src/index.ts` — re-export them (explicit export list, ~line 140).
- `libs/event-processor/src/engine/error-event-publisher.ts` — type the built subject `satisfies ErrorEventSubject`.
- `services/ledger/ledger-ctrl/src/domain/contracts.ts` — add `AccountSnapshotSchema`, `TaxLotSchema`, `SnapshotHistorySchema` + types; document failure events.
- `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts` — `TaxLot` row → `TaxLotEntry = TableEntry<TaxLot, {tenantId}>`; add `createdAt` to `saveSnapshot`.
- `services/ledger/ledger-ctrl/src/services/tax-lot-manager.ts` — construct `TaxLotEntry` with `createdAt`; fix imports/re-export.
- `services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts` — `SnapshotRecord` → `TableEntry<AccountSnapshot, RequestContext>` (drop `[key:string]:unknown`); type the 4 `record()` payloads.
- `tsconfig.base.json` — add `@nestfolio/reconciliation-ctrl/contracts` path.
- `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts` — type the 2 `record()` payloads.
- `services/ledger/ledger-ctrl/CLAUDE.md` + `services/ledger/reconciliation-ctrl/CLAUDE.md` — service-card Contracts sections.

---

## Task 1: Shared platform `ErrorEventSubjectSchema` (libs/event-processor)

**Files:**
- Modify: `libs/event-processor/src/domain/schemas.ts`
- Modify: `libs/event-processor/src/index.ts:140`
- Modify: `libs/event-processor/src/engine/error-event-publisher.ts:26-31`
- Test: `libs/event-processor/test/error-event-subject-schema.test.ts`

The error-event-publisher builds the subject as `{ error: string, stack: string|undefined, causedBy: unknown, groupKey?: string }` (`error-event-publisher.ts:26-31`). This shape is identical for every service, so it gets ONE shared contract.

- [ ] **Step 1: Write the failing unit test**

Create `libs/event-processor/test/error-event-subject-schema.test.ts`:

```ts
import { ErrorEventSubjectSchema } from '../src';

describe('ErrorEventSubjectSchema', () => {
  it('parses the shape ErrorEventPublisher emits (with groupKey)', () => {
    const subject = {
      error: 'boom',
      stack: 'Error: boom\n    at x',
      causedBy: { name: 'TypeError' },
      groupKey: 'tenant#123',
    };
    expect(ErrorEventSubjectSchema.parse(subject)).toEqual(subject);
  });

  it('parses without optional stack/groupKey', () => {
    const subject = { error: 'boom', causedBy: undefined };
    const parsed = ErrorEventSubjectSchema.parse(subject);
    expect(parsed.error).toBe('boom');
    expect(parsed.groupKey).toBeUndefined();
  });

  it('rejects a missing error message', () => {
    expect(() => ErrorEventSubjectSchema.parse({ causedBy: 1 })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx test event-processor --testPathPatterns error-event-subject-schema`
Expected: FAIL — `ErrorEventSubjectSchema` is not exported.

- [ ] **Step 3: Add the schema to `domain/schemas.ts`**

Append to `libs/event-processor/src/domain/schemas.ts` (after `BusEventSchema`):

```ts
/**
 * Shared platform contract for the subject of every `errorEventType` emission
 * (built by ErrorEventPublisher). NOT a producer aggregate — the shape is
 * identical across all services, so one schema is the contract program-wide.
 * Consumers of any *_FAILED event parse via this.
 */
export const ErrorEventSubjectSchema = z.object({
  error: z.string(),
  stack: z.string().optional(),
  causedBy: z.unknown(),
  groupKey: z.string().optional(),
});

export type ErrorEventSubject = z.infer<typeof ErrorEventSubjectSchema>;
```

- [ ] **Step 4: Re-export from the package index**

In `libs/event-processor/src/index.ts`, find the explicit re-export of `BusEventSchema`/`RequestContextSchema` from `./domain` (around line 140) and add the two new names. The exact edit (match the existing `export { ... } from './domain';` value-export group — `ErrorEventSubjectSchema` is a value, `ErrorEventSubject` is a type):

```ts
// value export group from './domain'
export { RequestContextSchema, BusEventSchema, ErrorEventSubjectSchema, /* …existing… */ } from './domain';
// type export group from './domain'
export type { BusEventPayload, RequestContext, RegionContext, SubjectContext, ErrorEventSubject } from './domain';
```

(If `./domain` is a barrel that does not yet re-export `schemas.ts` symbols, add them to `libs/event-processor/src/domain/index.ts` first.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm nx test event-processor --testPathPatterns error-event-subject-schema`
Expected: PASS.

- [ ] **Step 6: Lock the producer to the contract**

In `libs/event-processor/src/engine/error-event-publisher.ts`, import the type and annotate the built subject so a future shape drift breaks the build:

```ts
import type { RequestContext, ErrorEventSubject } from '../domain/schemas';
```

```ts
        const subject: ErrorEventSubject = {
          error: error.message,
          stack: error.stack,
          causedBy,
          ...(groupKey && { groupKey }),
        };
        const detail = {
          id: getUUID(),
          type: errorEventType,
          timestamp: getTime(),
          subject,
          ...(context && { context }),
        };
```

- [ ] **Step 7: Verify the lib builds + unit suite green**

Run: `pnpm nx run-many -t test,typecheck -p event-processor`
Expected: PASS (no `tsc` errors; error-publisher tests still green).

- [ ] **Step 8: Commit**

```bash
git add libs/event-processor/src/domain/schemas.ts libs/event-processor/src/index.ts libs/event-processor/src/engine/error-event-publisher.ts libs/event-processor/test/error-event-subject-schema.test.ts
git commit --no-verify -m "feat(event-processor): shared ErrorEventSubjectSchema for errorEventType emissions"
```

---

## Task 2: ledger-ctrl contracts — add AccountSnapshot / TaxLot / SnapshotHistory schemas

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/domain/contracts.ts`
- Test: `services/ledger/ledger-ctrl/test/domain/contracts.test.ts`

The three existing event-subject contracts (`BalanceUpdated`, `PortfolioUpdated`, `LedgerEntryRecorded`) and the two shared nested schemas (`LedgerPosition`, `LedgerSnapshot`) stay. Add aggregates for the two inline rows being converted (Tasks 3-4) plus the internal `SnapshotHistory` record so every `record()` payload in `snapshot-to-events.ts` is typed.

- [ ] **Step 1: Write the failing unit test**

Create (or extend) `services/ledger/ledger-ctrl/test/domain/contracts.test.ts`:

```ts
import {
  AccountSnapshotSchema,
  TaxLotSchema,
  SnapshotHistorySchema,
  LedgerPositionSchema,
} from '../../src/domain/contracts';

const position = {
  symbol: 'VTI', quantity: 50, averageCostBasis: 200,
  totalCostBasis: 10000, lastFillPrice: 210,
};

describe('ledger-ctrl AccountSnapshotSchema', () => {
  it('parses a persisted-snapshot aggregate (no identity/keys)', () => {
    const subject = {
      streamType: 'actual',
      positions: { VTI: position },
      cashBalanceCents: 500000,
      totalValueCents: 1550000,
      positionCount: 1,
      lastEventSequence: 7,
      version: 7,
      snapshotAt: '2026-06-09T00:00:00.000Z',
      timestamp: '2026-06-09T00:00:00.000Z',
    };
    expect(AccountSnapshotSchema.parse(subject)).toMatchObject({ lastEventSequence: 7 });
  });
});

describe('ledger-ctrl TaxLotSchema', () => {
  it('parses a tax-lot aggregate (no pk/sk/__typename/tenantId)', () => {
    const subject = {
      lotId: 'order1-VTI', symbol: 'VTI', quantity: 10,
      costBasisPerShare: 200, acquiredAt: '2026-06-09T00:00:00.000Z', status: 'open',
    };
    expect(TaxLotSchema.parse(subject)).toEqual(subject);
  });
  it('rejects an invalid status', () => {
    expect(() => TaxLotSchema.parse({
      lotId: 'x', symbol: 'VTI', quantity: 1, costBasisPerShare: 1,
      acquiredAt: '2026-06-09T00:00:00.000Z', status: 'frozen',
    })).toThrow();
  });
});

describe('ledger-ctrl SnapshotHistorySchema', () => {
  it('parses the append-only snapshot-history aggregate', () => {
    const subject = {
      streamType: 'actual',
      positions: { VTI: position },
      cashBalanceCents: 500000,
      lastEventSequence: 7,
    };
    expect(SnapshotHistorySchema.parse(subject)).toMatchObject({ lastEventSequence: 7 });
  });
});

it('LedgerPositionSchema is reused for snapshot positions', () => {
  expect(LedgerPositionSchema.parse(position)).toEqual(position);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx test ledger-ctrl --testPathPatterns domain/contracts`
Expected: FAIL — `AccountSnapshotSchema`/`TaxLotSchema`/`SnapshotHistorySchema` not exported.

- [ ] **Step 3: Add the schemas to `contracts.ts`**

Append to `services/ledger/ledger-ctrl/src/domain/contracts.ts` (keep the "imports ONLY zod" rule):

```ts
/** The persisted AccountSnapshot row aggregate (the `Snapshot#latest` item the
 * reducer materializes; the source SnapshotRecord the CDC transform reads). Dry
 * subject — identity (tenant/user/region) travels in the RequestContext. */
export const AccountSnapshotSchema = z.object({
  streamType: z.string(),
  positions: z.record(LedgerPositionSchema),
  cashBalanceCents: z.number(),
  totalValueCents: z.number(),
  positionCount: z.number().optional(),
  lastEventSequence: z.number(),
  version: z.number(),
  snapshotAt: z.string(),
  timestamp: z.string(),
});
export type AccountSnapshot = z.infer<typeof AccountSnapshotSchema>;

/** A single tax lot (FIFO cost-basis tracking). Internal aggregate — tenant-scoped
 * only (no user/region); identity travels in the context. */
export const TaxLotSchema = z.object({
  lotId: z.string(),
  symbol: z.string(),
  quantity: z.number(),
  costBasisPerShare: z.number(),
  acquiredAt: z.string(),
  status: z.enum(['open', 'closed']),
});
export type TaxLot = z.infer<typeof TaxLotSchema>;

/** Append-only snapshot-history aggregate (TTL'd). Internal — not CDC-emitted. */
export const SnapshotHistorySchema = z.object({
  streamType: z.string(),
  positions: z.record(LedgerPositionSchema),
  cashBalanceCents: z.number(),
  lastEventSequence: z.number(),
});
export type SnapshotHistory = z.infer<typeof SnapshotHistorySchema>;

/** Failure events (LEDGER_PROCESSING_FAILED, LEDGER_SNAPSHOT_PUBLISHER_FAILED) use
 * the SHARED platform contract — import { ErrorEventSubjectSchema } from
 * '@nestfolio/event-processor'. They are not producer aggregates. */
```

> `positions` in `AccountSnapshot`/`SnapshotHistory` reuses `LedgerPositionSchema` because `reducer`/`saveSnapshot` store `PositionSnapshot` objects (`symbol/quantity/averageCostBasis/totalCostBasis/lastFillPrice`) — structurally identical to `LedgerPosition`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx test ledger-ctrl --testPathPatterns domain/contracts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-ctrl/src/domain/contracts.ts services/ledger/ledger-ctrl/test/domain/contracts.test.ts
git commit --no-verify -m "feat(ledger-ctrl): add AccountSnapshot/TaxLot/SnapshotHistory subject contracts"
```

---

## Task 3: ledger-ctrl — convert `TaxLot` row to `TableEntry<TaxLot, {tenantId}>`

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts:36-47,229-261`
- Modify: `services/ledger/ledger-ctrl/src/services/tax-lot-manager.ts:1-47`
- Test: `services/ledger/ledger-ctrl/test/tax-lot-manager.test.ts` (existing), `repositories/ledger.repository.test.ts` (existing)

The subject `TaxLot` now lives in `contracts.ts` (Task 2). The persisted row becomes `TaxLotEntry = TableEntry<TaxLot, { tenantId: string }> & { __typename: 'TaxLot' }` — tenant-only context (the real row carries no `userId`/`region`), with `createdAt` added (required by `TableEntry`, not stamped by `put()`).

- [ ] **Step 1: Confirm there are no external importers of the row type `TaxLot`**

Run: `grep -rn "TaxLot" services libs apps --include=*.ts | grep -v "services/ledger/ledger-ctrl" | grep -v "\.test\."`
Expected: no cross-service imports of `TaxLot` (it is internal to ledger-ctrl). If any appear, update them to `TaxLotEntry` in this task.

- [ ] **Step 2: Rewrite the row type in `ledger.repository.ts`**

Replace the inline `export type TaxLot = { … }` (lines 36-47) with an import-backed row alias. Update the imports at the top (line 3-5) to add `TableEntry` and the subject:

```ts
import {
  TableRepository, getTime, type RequestContext, type TableEntry,
} from '@nestfolio/event-processor';
import type { TaxLot } from '../domain/contracts';
```

Replace lines 36-47 with:

```ts
/** Persisted tax-lot row. Tenant-scoped only (no user/region). */
export type TaxLotEntry = TableEntry<TaxLot, { tenantId: string }> & { __typename: 'TaxLot' };
```

Update the repository method signatures (lines 229-249):

```ts
  readonly putTaxLot = this.log('putTaxLot',
    async (lot: TaxLotEntry): Promise<void> => {
      await this.put(lot);
    },
  );

  readonly getOpenLotsBySymbol = this.log('getOpenLotsBySymbol',
    async (tenantId: string, symbol: string): Promise<TaxLotEntry[]> => {
      return this.queryAll<TaxLotEntry>({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        FilterExpression: '#status = :open',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':pk': `TaxLot#${tenantId}#${symbol}`,
          ':skPrefix': 'Lot#',
          ':open': 'open',
        },
      });
    },
  );
```

> `DispositionRecord` (lines 49-59) is a payload type with NO inline `pk/sk/__typename` — leave it unchanged (not an inline-row anti-pattern; not in scope).

- [ ] **Step 3: Update `tax-lot-manager.ts` construction + imports**

Replace lines 1-4:

```ts
import { withMethodLogging, logger, getTime } from '@nestfolio/event-processor';
import { LedgerRepository, type TaxLotEntry, type DispositionRecord } from '../repositories/ledger.repository';

export type { TaxLotEntry, DispositionRecord };
```

Replace the lot literal in `openLot` (lines 32-43) — add `createdAt`, type as `TaxLotEntry`:

```ts
      const lot: TaxLotEntry = {
        pk: `TaxLot#${params.tenantId}#${params.symbol}`,
        sk: `Lot#${params.acquiredAt}#${lotId}`,
        __typename: 'TaxLot',
        tenantId: params.tenantId,
        createdAt: getTime(),
        lotId,
        symbol: params.symbol,
        quantity: params.quantity,
        costBasisPerShare: params.costBasisPerShare,
        acquiredAt: params.acquiredAt,
        status: 'open',
      };
```

> `closeLots`/`getUnrealizedGains` read `lot.quantity/costBasisPerShare/acquiredAt/lotId/pk/sk` — all present on `TaxLotEntry`. No change needed beyond the type rename.

- [ ] **Step 4: Run the typecheck + existing tax-lot tests**

Run: `pnpm nx run-many -t typecheck,test -p ledger-ctrl --testPathPatterns "tax-lot|ledger.repository"`
Expected: PASS. If a test references the old `TaxLot` row type name, rename it to `TaxLotEntry` (the subject `TaxLot` from contracts is the aggregate).

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts services/ledger/ledger-ctrl/src/services/tax-lot-manager.ts services/ledger/ledger-ctrl/test
git commit --no-verify -m "refactor(ledger-ctrl): TaxLot row -> TableEntry<TaxLot, {tenantId}> + createdAt"
```

---

## Task 4: ledger-ctrl — convert `SnapshotRecord` to `TableEntry<AccountSnapshot>` + type the `record()` payloads

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts`
- Modify: `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts:139-157` (`saveSnapshot` — add `createdAt`)
- Test: `services/ledger/ledger-ctrl/test/transforms/snapshot-to-events.test.ts` (existing)

`SnapshotRecord` is the `AccountSnapshot` DDB-stream image read by `snapshotToEvents`. Replace the hand-rolled interface (with its `[key: string]: unknown` drift-hider) with `TableEntry<AccountSnapshot, RequestContext>`, and type each `record()` subject against its contract.

- [ ] **Step 1: Add `createdAt` to the persisted AccountSnapshot row**

In `ledger.repository.ts` `saveSnapshot`, add `createdAt: now` to the `Item` (the row is rewritten per version; `createdAt` = this snapshot version's write time, making the `TableEntry` honest). Edit the `Item` object (around lines 144-157):

```ts
            Item: {
              pk,
              sk: 'Snapshot#latest',
              __typename: 'AccountSnapshot',
              ...ctx,
              createdAt: now,
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
```

- [ ] **Step 2: Rewrite `snapshot-to-events.ts`**

Replace the `SnapshotRecord` interface (lines 4-19) and type the payloads. New file head:

```ts
import { record, type RecordIntent } from '@nestfolio/event-processor';
import type { RequestContext, TableEntry } from '@nestfolio/event-processor';
import type {
  AccountSnapshot, BalanceUpdated, PortfolioUpdated, LedgerEntryRecorded, SnapshotHistory, LedgerSnapshot,
} from '../domain/contracts';

/** The persisted AccountSnapshot row (DDB-stream image). */
export type SnapshotRecord = TableEntry<AccountSnapshot, RequestContext>;
```

Then rewrite the body of `snapshotToEvents` so each `record()` subject is a typed local (identity `tenantId` kept alongside, behavior-preserving — see "Out of scope"):

```ts
export function snapshotToEvents(
  current: SnapshotRecord,
  previous: SnapshotRecord | undefined,
): RecordIntent[] {
  const { pk, streamType, timestamp, lastEventSequence } = current;
  const sk = (typename: string) => `${typename}#${timestamp}#${lastEventSequence}`;
  const overrides = (typename: string) => ({ pk, sk: sk(typename) });

  const snapshot: LedgerSnapshot = {
    positions: current.positions,
    cashBalanceCents: current.cashBalanceCents,
    lastEventSequence,
  };

  const balanceChanged = !previous || current.cashBalanceCents !== previous.cashBalanceCents;
  const positionsChanged = !previous || JSON.stringify(current.positions) !== JSON.stringify(previous.positions);

  const intents: RecordIntent[] = [];

  if (balanceChanged) {
    const subject: BalanceUpdated = {
      streamType,
      cashBalanceCents: current.cashBalanceCents,
      totalValueCents: current.totalValueCents,
      snapshot,
    };
    intents.push(record('BalanceEvent', { tenantId: current.tenantId, ...subject }, overrides('BalanceEvent')));
  }

  if (positionsChanged) {
    const subject: PortfolioUpdated = {
      streamType,
      positions: current.positions,
      positionCount: Object.keys(current.positions).length,
      totalValueCents: current.totalValueCents,
      snapshot,
    };
    intents.push(record('PortfolioEvent', { tenantId: current.tenantId, ...subject }, overrides('PortfolioEvent')));
  }

  const ledgerEntry: LedgerEntryRecorded = {
    streamType,
    lastEventSequence,
    snapshotAt: current.snapshotAt,
    snapshot,
  };
  intents.push(record('LedgerEntryEvent', { tenantId: current.tenantId, ...ledgerEntry }, overrides('LedgerEntryEvent')));

  const history: SnapshotHistory = {
    streamType,
    positions: current.positions,
    cashBalanceCents: current.cashBalanceCents,
    lastEventSequence,
  };
  intents.push(record(
    'SnapshotHistory',
    { tenantId: current.tenantId, ...history, ttl: Math.floor(Date.now() / 1000) + (365 * 86400) },
    { pk, sk: `SnapshotAt#${timestamp}` },
  ));

  return intents;
}
```

> `current.positions` is `Record<string, LedgerPosition>` via `AccountSnapshot`, so it assigns cleanly to `LedgerSnapshot.positions` and `PortfolioUpdated.positions` (both `z.record(LedgerPositionSchema)`). This removes the previous `satisfies Pick<…>` gymnastics. `Date.now()` is used exactly as before (no behavior change).

- [ ] **Step 3: Run the typecheck + snapshot-to-events tests**

Run: `pnpm nx run-many -t typecheck,test -p ledger-ctrl --testPathPatterns "snapshot-to-events|ledger.repository"`
Expected: PASS. If the existing test built a `SnapshotRecord` fixture relying on arbitrary extra keys (the old `[key:string]:unknown`), drop the extras so the fixture matches `TableEntry<AccountSnapshot>` (it must include `pk/sk/__typename/createdAt/tenantId/userId/region`).

- [ ] **Step 4: Full ledger-ctrl unit suite + typecheck**

Run: `pnpm nx run-many -t typecheck,test -p ledger-ctrl`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts services/ledger/ledger-ctrl/test
git commit --no-verify -m "refactor(ledger-ctrl): SnapshotRecord -> TableEntry<AccountSnapshot>; type record() subjects"
```

---

## Task 5: reconciliation-ctrl contracts — new `domain/contracts.ts` + tsconfig path

**Files:**
- Create: `services/ledger/reconciliation-ctrl/src/domain/contracts.ts`
- Modify: `tsconfig.base.json`
- Test: `services/ledger/reconciliation-ctrl/test/domain/contracts.test.ts`

reconciliation-ctrl emits exactly two CDC rows: `ReconciliationResult` (→ `RECONCILIATION_COMPLETED` / `RECONCILIATION_RESULT_UPDATED`) and `DriftRecord` (→ `PORTFOLIO_DRIFT_DETECTED` / `DRIFT_RECORD_UPDATED`). The other 9 declared event names are consumed-only or declared-but-unused → no contracts.

- [ ] **Step 1: Write the failing unit test**

Create `services/ledger/reconciliation-ctrl/test/domain/contracts.test.ts`:

```ts
import { ReconciliationResultSchema, DriftRecordSchema } from '../../src/domain/contracts';

describe('reconciliation-ctrl contracts', () => {
  it('ReconciliationResultSchema parses a result aggregate (no identity)', () => {
    const subject = { reconciliationId: 'r1', status: 'DRIFT_DETECTED', driftCount: 2 };
    expect(ReconciliationResultSchema.parse(subject)).toEqual(subject);
  });

  it('ReconciliationResultSchema rejects an unknown status', () => {
    expect(() => ReconciliationResultSchema.parse({
      reconciliationId: 'r1', status: 'PENDING', driftCount: 0,
    })).toThrow();
  });

  it('DriftRecordSchema parses a drift aggregate (no identity)', () => {
    const subject = {
      reconciliationId: 'r1', instrument: 'VTI',
      intentQty: 50, settlementQty: 45, drift: 5,
    };
    expect(DriftRecordSchema.parse(subject)).toEqual(subject);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm nx test reconciliation-ctrl --testPathPatterns domain/contracts`
Expected: FAIL — module `../../src/domain/contracts` does not exist.

- [ ] **Step 3: Create `domain/contracts.ts`**

Create `services/ledger/reconciliation-ctrl/src/domain/contracts.ts`:

```ts
// Producer-owned event payload contracts for reconciliation-ctrl. Imports ONLY zod.
import { z } from 'zod';

/** ReconciliationResult subject — emitted as RECONCILIATION_COMPLETED (insert) /
 * RECONCILIATION_RESULT_UPDATED (modify). Dry subject — identity travels in the
 * event context (RequestContext), not here. */
export const ReconciliationResultSchema = z.object({
  reconciliationId: z.string(),
  status: z.enum(['COMPLETED', 'DRIFT_DETECTED']),
  driftCount: z.number(),
});
export type ReconciliationResult = z.infer<typeof ReconciliationResultSchema>;

/** DriftRecord subject — emitted as PORTFOLIO_DRIFT_DETECTED (insert) /
 * DRIFT_RECORD_UPDATED (modify). Dry subject — identity travels in the context. */
export const DriftRecordSchema = z.object({
  reconciliationId: z.string(),
  instrument: z.string(),
  intentQty: z.number(),
  settlementQty: z.number(),
  drift: z.number(),
});
export type DriftRecord = z.infer<typeof DriftRecordSchema>;
```

- [ ] **Step 4: Add the tsconfig path**

In `tsconfig.base.json` `compilerOptions.paths`, add (next to other `@nestfolio/*-ctrl/*` entries):

```json
      "@nestfolio/reconciliation-ctrl/contracts": ["services/ledger/reconciliation-ctrl/src/domain/contracts.ts"],
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm nx test reconciliation-ctrl --testPathPatterns domain/contracts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/ledger/reconciliation-ctrl/src/domain/contracts.ts tsconfig.base.json services/ledger/reconciliation-ctrl/test/domain/contracts.test.ts
git commit --no-verify -m "feat(reconciliation-ctrl): ReconciliationResult + DriftRecord subject contracts"
```

---

## Task 6: reconciliation-ctrl — type the `record()` payloads in `event-listener.ts`

**Files:**
- Modify: `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts:142-157`
- Test: `services/ledger/reconciliation-ctrl/test/event-listener.test.ts` (existing)

Type each `record()` subject against the contract (identity `tenantId` kept alongside, behavior-preserving).

- [ ] **Step 1: Import the contract types**

Add to the imports of `event-listener.ts`:

```ts
import type { ReconciliationResult, DriftRecord } from '../domain/contracts';
```

- [ ] **Step 2: Type the payloads**

Replace the `return [ … ]` block (lines 141-158) with typed subjects:

```ts
  const resultSubject: ReconciliationResult = {
    reconciliationId,
    status: result.status,
    driftCount: result.drifts.length,
  };
  return [
    record('ReconciliationResult', { tenantId, ...resultSubject }, { pk, sk: 'Reconciliation' }),
    ...result.drifts.map((d) => {
      const driftSubject: DriftRecord = {
        reconciliationId,
        instrument: d.instrument,
        intentQty: d.intentQty,
        settlementQty: d.settlementQty,
        drift: d.drift,
      };
      return record('DriftRecord', { tenantId, ...driftSubject }, { pk, sk: `DriftRecord#${d.instrument}` });
    }),
  ];
```

> `result.status` is `'COMPLETED' | 'DRIFT_DETECTED'` (matches `ReconciliationResultSchema`); `DriftEntry` fields are all `string`/`number` (match `DriftRecordSchema`). Build breaks if either drifts.

- [ ] **Step 3: Run the typecheck + existing reconciliation tests**

Run: `pnpm nx run-many -t typecheck,test -p reconciliation-ctrl`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts services/ledger/reconciliation-ctrl/test
git commit --no-verify -m "refactor(reconciliation-ctrl): type record() subjects against producer contracts"
```

---

## Task 7: Update service cards (CLAUDE.md)

**Files:**
- Modify: `services/ledger/ledger-ctrl/CLAUDE.md`
- Modify: `services/ledger/reconciliation-ctrl/CLAUDE.md`

- [ ] **Step 1: ledger-ctrl card — extend the Contracts section**

Add `AccountSnapshotSchema`, `TaxLotSchema`, `SnapshotHistorySchema` bullets to the `## Contracts (domain/contracts.ts → @nestfolio/ledger-ctrl/contracts)` list, and add a line:
`- Failure events (LEDGER_PROCESSING_FAILED, LEDGER_SNAPSHOT_PUBLISHER_FAILED) use the shared @nestfolio/event-processor ErrorEventSubjectSchema (not a producer aggregate).`
And note `TaxLot`/`SnapshotRecord` rows are now `TableEntry<Subject>`.

- [ ] **Step 2: reconciliation-ctrl card — add a Contracts section**

Insert after the `## Egress` section:

```md
## Contracts (domain/contracts.ts → @nestfolio/reconciliation-ctrl/contracts)
Producer-owned zod payload contracts for the 2 CDC-emitted rows (imports ONLY zod). Dry subjects — identity travels in the event context.
- ReconciliationResultSchema — RECONCILIATION_COMPLETED / RECONCILIATION_RESULT_UPDATED subject
- DriftRecordSchema — PORTFOLIO_DRIFT_DETECTED / DRIFT_RECORD_UPDATED subject
- The other declared event names are consumed-only (CORPORATE_ACTION_APPLIED) or declared-but-unused (no contract).
```

- [ ] **Step 3: Commit**

```bash
git add services/ledger/ledger-ctrl/CLAUDE.md services/ledger/reconciliation-ctrl/CLAUDE.md
git commit --no-verify -m "docs(ledger): regen service cards for typed-subject contracts"
```

---

## Task 8: Validation gate e2e — parse REAL deployed rows against the contracts

**Files:**
- Create: `apps/e2e-feature-tests/src/helpers/contract-assert.ts`
- Create: `apps/e2e-feature-tests/src/ledger/ledger-contract-emission.e2e.test.ts`

This is the #1-risk gate (Q1). It drives real fixtures, reads the real persisted rows from each producer's table, and parses them with the producer contracts. Modeled on `apps/e2e-feature-tests/src/advisory/reconciliation-correction.e2e.test.ts` (DDB readback + polling).

- [ ] **Step 1: Add the reusable assertion helper**

Create `apps/e2e-feature-tests/src/helpers/contract-assert.ts`:

```ts
import type { ZodTypeAny, z } from 'zod';

/**
 * Validate a REAL persisted producer row against its producer contract.
 * The CDC publisher emits the whole row as the event subject, so a row that
 * parses IS proof the emitted subject satisfies the contract (declared fields
 * present + correctly typed; zod strips identity/keys). Returns the parsed
 * aggregate for further field assertions.
 */
export function expectContractMatch<S extends ZodTypeAny>(
  schema: S, row: Record<string, unknown> | undefined, label: string,
): z.infer<S> {
  if (!row) throw new Error(`expectContractMatch(${label}): row was undefined`);
  const result = schema.safeParse(row);
  if (!result.success) {
    throw new Error(`Contract drift for ${label}: ${JSON.stringify(result.error.issues, null, 2)}`);
  }
  return result.data;
}
```

- [ ] **Step 2: Write the e2e scenario**

Create `apps/e2e-feature-tests/src/ledger/ledger-contract-emission.e2e.test.ts`:

```ts
import { createTestContext, EventBridgeClient, type TestContext } from '@nestfolio/test-support';
import { freshTenant, applyFixtures, onboarded, funded, withHoldings, type FreshTenant } from '..';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { AlpacaAdptEventTypes } from '@nestfolio/broker-alpaca-adpt/events';
import {
  BalanceUpdatedSchema, PortfolioUpdatedSchema, LedgerEntryRecordedSchema, AccountSnapshotSchema,
} from '@nestfolio/ledger-ctrl/contracts';
import { ReconciliationResultSchema, DriftRecordSchema } from '@nestfolio/reconciliation-ctrl/contracts';
import { expectContractMatch } from '../helpers/contract-assert';

const poll = async <T>(fn: () => Promise<T | undefined>, deadlineMs: number): Promise<T> => {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise(r => setTimeout(r, 3_000));
  }
  throw new Error('poll timed out');
};

describe('ledger-domain producer contracts match REAL deployed emission', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let ddb: DynamoDBDocumentClient;
  let client: DynamoDBClient;

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
    client = new DynamoDBClient({ region: ctx.region });
    ddb = DynamoDBDocumentClient.from(client);
  }, 600_000);

  afterEach(async () => {
    client?.destroy();
    await ctx.cleanup.runAll();
  }, 60_000);

  it('ledger-ctrl: AccountSnapshot + Balance/Portfolio/LedgerEntry subjects parse', async () => {
    const table = await ctx.ssm.tableName('ledger-ctrl');
    const pk = `Account#${tenant.tenantId}#actual`;

    const snapshot = await poll(async () => {
      const r = await ddb.send(new GetCommand({ TableName: table, Key: { pk, sk: 'Snapshot#latest' } }));
      return r.Item;
    }, 120_000);
    expectContractMatch(AccountSnapshotSchema, snapshot, 'AccountSnapshot');

    const rowsFor = async (typename: string) => {
      const r = await ddb.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: { ':pk': pk, ':sk': `${typename}#` },
      }));
      return r.Items ?? [];
    };

    const balances = await poll(async () => {
      const items = await rowsFor('BalanceEvent');
      return items.length ? items : undefined;
    }, 120_000);
    balances.forEach((row, i) => expectContractMatch(BalanceUpdatedSchema, row, `BalanceUpdated[${i}]`));

    const portfolios = await rowsFor('PortfolioEvent');
    expect(portfolios.length).toBeGreaterThan(0);
    portfolios.forEach((row, i) => expectContractMatch(PortfolioUpdatedSchema, row, `PortfolioUpdated[${i}]`));

    const ledgerEntries = await rowsFor('LedgerEntryEvent');
    expect(ledgerEntries.length).toBeGreaterThan(0);
    ledgerEntries.forEach((row, i) => expectContractMatch(LedgerEntryRecordedSchema, row, `LedgerEntryRecorded[${i}]`));
  }, 420_000);

  it('reconciliation-ctrl: ReconciliationResult + DriftRecord subjects parse', async () => {
    const table = await ctx.ssm.tableName('reconciliation-ctrl');
    const eb = new EventBridgeClient(ctx);

    // Wait for the Intent position cache (seeded by the PORTFOLIO_UPDATED CDC chain).
    await poll(async () => {
      const r = await ddb.send(new GetCommand({
        TableName: table, Key: { pk: `PositionCache#${tenant.tenantId}`, sk: 'Intent' },
      }));
      return r.Item;
    }, 120_000);

    // Trigger drift with mismatched settlement quantities.
    await eb.putEvent({
      bus: 'ledger', targetService: 'reconciliation-ctrl',
      detailType: AlpacaAdptEventTypes.ALPACA_ACCOUNT_SNAPSHOT,
      detail: {
        tenantId: tenant.tenantId, userId: tenant.userId, portfolioId: tenant.tenantId,
        positions: [
          { symbol: 'VTI', qty: 45, marketValue: 9000 },
          { symbol: 'BND', qty: 25, marketValue: 2000 },
        ],
      },
    });

    // Read the emitted rows back via the tenantId-index GSI (PK=tenantId, SK=__typename).
    const byTypename = async (typename: string) => {
      const r = await ddb.send(new QueryCommand({
        TableName: table, IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :t AND #tn = :tn',
        ExpressionAttributeNames: { '#tn': '__typename' },
        ExpressionAttributeValues: { ':t': tenant.tenantId, ':tn': typename },
      }));
      return r.Items ?? [];
    };

    const results = await poll(async () => {
      const items = await byTypename('ReconciliationResult');
      return items.length ? items : undefined;
    }, 180_000);
    results.forEach((row, i) => expectContractMatch(ReconciliationResultSchema, row, `ReconciliationResult[${i}]`));

    const drifts = await poll(async () => {
      const items = await byTypename('DriftRecord');
      return items.length ? items : undefined;
    }, 60_000);
    drifts.forEach((row, i) => expectContractMatch(DriftRecordSchema, row, `DriftRecord[${i}]`));
  }, 420_000);
});
```

> Verify at execution: (a) the `tenantId-index` GSI projects ALL attributes on the reconciliation-ctrl table (memory note: `tenantId-index` PK=tenantId, SK=__typename, ALL) — if it is KEYS_ONLY, switch to a `pk = Reconciliation#${tenantId}#…` query after discovering the `reconciliationId` (e.g. from the GSI keys then a `GetItem`); (b) `funded`/`withHoldings`/`onboarded` import names match `apps/e2e-feature-tests/src/index.ts`; (c) the actual `streamType` segment of the ledger pk is `actual`.

- [ ] **Step 3: Typecheck the e2e app (do NOT run against dev yet — that happens in the closing phase)**

Run: `pnpm nx run e2e-feature-tests:typecheck` (or `pnpm nx typecheck e2e-feature-tests`)
Expected: PASS — all contract imports resolve; no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/contract-assert.ts apps/e2e-feature-tests/src/ledger
git commit --no-verify -m "test(e2e): validate ledger-domain contracts against real deployed emission"
```

---

## Task 9: Workspace verification (pre-deploy)

**Files:** none.

- [ ] **Step 1: Affected typecheck + unit/lint across the slice**

Run: `pnpm nx run-many -t typecheck,test,lint -p event-processor,ledger-ctrl,reconciliation-ctrl,e2e-feature-tests`
Expected: PASS. Fix any drift before the closing-phase deploy.

- [ ] **Step 2: Confirm no stray `as Record`/`as <LocalType>` reintroduced in the touched files**

Run: `grep -rn "as Record<string" services/ledger/ledger-ctrl/src/transforms services/ledger/reconciliation-ctrl/src/handlers services/ledger/ledger-ctrl/src/services`
Expected: no new casts in the converted files (the conversions remove the `[key:string]:unknown` drift-hider and type the `record()` subjects).

> The deploy (`--services=ledger-ctrl,reconciliation-ctrl`) + scoped e2e run of `ledger-contract-emission.e2e.test.ts` is the `/backlog-next` closing phase (steps 6.3–6.4), not a plan task. `libs/event-processor`, `tsconfig.base.json`, and `apps/e2e-feature-tests` changes are covered by that deploy because both producers redeploy with the new bundles.

---

## Self-Review

**Spec coverage** (design § "Ledger (slice 1)"):
- ledger-ctrl extend contracts to cover all emitted events → Task 2 (AccountSnapshot/TaxLot/SnapshotHistory) + Task 1/Q3 (failure events via shared schema). The 3 event-subject contracts already covered BALANCE/PORTFOLIO/LEDGER_ENTRY (+ their `_EVENT_UPDATED` modify variants reuse the same subject). ✓
- Convert `TaxLot` → `TableEntry<Subject>` → Task 3. ✓
- Convert `SnapshotRecord` → `TableEntry<Subject>` → Task 4. ✓
- reconciliation-ctrl new contracts for PORTFOLIO_DRIFT_DETECTED + reconciliation lifecycle + drift/projection → Task 5 (the only 4 truly-emitted events, from 2 rows; the rest are consumed-only/unused — documented). ✓
- Home rule (intra-domain import producer `/contracts`) → tsconfig path added (Task 5); cross-domain deferred to WS-3 per Q2. ✓
- Validation against REAL emission, not fixtures → Task 8 (parse real deployed rows). ✓ Producer unit tests + tsc → Tasks 1-6, Task 9. ✓
- Depends on phase-0 taxonomy → uses `TableEntry<T,S extends SubjectContext>`, `RequestContext`, `{tenantId}` context. ✓

**Placeholder scan:** every code step shows complete code; commands have expected outcomes; the two execution-time verifications (GSI projection, fixture import names) are explicit checks, not TODOs. ✓

**Type consistency:** subject names (`AccountSnapshot`, `TaxLot`, `SnapshotHistory`, `ReconciliationResult`, `DriftRecord`, `ErrorEventSubject`) used identically across schema defs, row aliases (`TaxLotEntry`, `SnapshotRecord`), `record()` payload typings, and e2e imports. Row alias `TaxLotEntry` (was `TaxLot`) renamed consistently in repository + tax-lot-manager. ✓
