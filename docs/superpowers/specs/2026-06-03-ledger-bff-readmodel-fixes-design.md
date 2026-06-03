# ledger-bff read-model fixes — design

Date: 2026-06-03
Backlog: `docs/backlog/ledger-bff-readmodel-fixes.md` (status: active)
Topic memory: `project_read_model_redesign.md`

## Problem

Two residuals from `bff-readmodel-w1-ledger-bff`, both in `ledger-bff`.

### A. The `LEDGER_ENTRY_RECORDED` P2 logs read fields the producer never emits

`services/ledger/ledger-bff/src/transforms/ledger-entry-recorded.ts` builds its two
P2 append-logs — `HistoryEntry` and `Checkpoint` — from **top-level** payload fields
(`payload.eventId`, `eventType`, `sequenceNo`, `timestamp`, `cashBalanceCents`,
`positions`). The real producer
(`services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts`, `LedgerEntryEvent`
→ `LEDGER_ENTRY_RECORDED`) emits only:

```
{ tenantId, streamType, lastEventSequence, snapshot: { positions, cashBalanceCents, lastEventSequence } }
```

WS-B (`read-model-ownership-w-b-version-carriage`, shipped 2026-06-02) settled this
contract; the snapshot shape is canonical and `lastEventSequence` is the version line.

**Observed production consequences (verified against current `main`):**

- Every `HistoryEntry` is written with `sk: Entry#${payload.sequenceNo}` = `Entry#undefined`.
  Since the pk (`History#${tenantId}`) is also fixed, **every entry collides on the same
  pk+sk and overwrites the previous one** — `getOrderHistory` returns at most one row,
  with `eventType=null`, `createdAt=undefined`, `sequenceNo=0`, `payload={}`.
- The `Checkpoint` gate `payload.sequenceNo % 100 === 0` evaluates `undefined % 100` → `NaN`
  → **never fires**. `getTimeTravelAvailability` always returns `{ earliestDate: null,
  latestDate: null }`.

These rows ARE read by live AppSync JS resolvers (not dead code):

- `get-order-history.fn.js` — pk-only query on `History#${tenantId}`,
  `scanIndexForward: false`; response maps `eventType`, `payload`, `createdAt`, `sequenceNo`.
- `get-time-travel-availability.fn.js` — pk-only query on `Checkpoint#${tenantId}`,
  `scanIndexForward: true`; returns `items[0].sk` / `items[last].sk` (the date strings).

The data the resolvers need is all reachable on the consumer side: event identity from
the EventBridge envelope (`event.id`, `event.type`, `event.timestamp` — already used by
the sibling `balanceUpdated` transform), state from `payload.snapshot.*`.

### B. ~18 latent `tsc --noEmit` errors block a clean service-wide typecheck

`npx tsc --noEmit -p services/ledger/ledger-bff/tsconfig.json` reports errors that do not
block deploy (esbuild strips types) or test (ts-jest lenient) but block a clean
`typecheck` target needed by the WS-D enforcement gate. Two clusters:

- `portfolio.repository.ts:78,98,118,144,162` — `'timestamp' does not exist in type
  'TableEntry'`. **All five are inside repository WRITE methods that have no production
  callers** (`upsertBalance`, `upsertPosition`, `appendHistory`, `saveCheckpoint`,
  `upsertSimulation`, `upsertSimulationPosition`, `saveSnapshotAt`). The live writer is the
  `materializeToTable` transform pipeline, not the repository.
- `event-listener.ts` — `UnitOfWork<BusEvent<…, …>>` not assignable to
  `UnitOfWork<BusEvent<…>>`: the three transform signatures declare `BusEvent<Record<string,
  unknown>>` (S defaults to `RequestContext`) while `toUow` returns `BusEvent<Record<string,
  unknown>, Record<string, unknown>>`.

**Repository dead-code map (verified):** live read methods are `getLatest`, `getPositions`,
`getSimulationLatest`, `getSimulationPositions`, `getSnapshotAt` (all from
`graphql-resolver.ts` / `time-travel.service.ts`). Dead: all 7 write methods **plus** 4
read methods — `getHistory`, `getCheckpoints`, `getCheckpointBefore`, `getEntriesSince`.
The dead reads encode the stale `${paddedSeq}` sk assumption and perpetuate scheme
confusion.

## Decision

**Part A — consumer re-source (chosen on design merit, not service count).** Re-widening
the producer (option 2) would duplicate envelope metadata + snapshot fields already on the
wire — strictly less clean and marginally larger payload. Re-sourcing reads each value from
its single canonical home and is consistent with the sibling `balanceUpdated` transform. No
producer change; deploy `ledger-bff` only.

**Part B — delete dead code, then fix residual types.** Removing the dead methods kills the
5 `TableEntry.timestamp` errors at the source and removes the competing sk scheme.

## Design

### Part A — rewrite `ledger-entry-recorded.ts`

Source fields from canonical locations. **`eventId` and `createdAt` are auto-injected onto
every `record()` row by the intent executor** (`intent-executor.ts:68` —
`eventId: ctx.eventId, createdAt: ctx.timestamp`, applied after the transform's fields), so
the transform must NOT set them. The transform supplies only:

| Field (transform-set) | Source |
| --- | --- |
| `eventType` | `event.type` (envelope detail-type, e.g. `"LEDGER_ENTRY_RECORDED"`) |
| `sequenceNo` | `payload.snapshot.lastEventSequence` |
| `cashBalanceCents` / `positions` | `payload.snapshot.*` |
| `streamType` | `payload.streamType` (default `'actual'`) |
| `payload` | snapshot summary `{ cashBalanceCents, positions, lastEventSequence }` |

(`eventId ← ctx.eventId`, `createdAt ← ctx.timestamp` arrive via the executor.)

- **`HistoryEntry` (P2, `record()`), actual stream only.** `sk: ${paddedSeq}` (8-digit
  zero-padded `lastEventSequence`): unique per monotonic sequence, recency-sorted under
  `scanIndexForward:false`, and idempotent on redelivery (same sequence → same sk). Keying on
  the business sequence rather than the envelope id keeps the key predictable (integration
  tests can compute it) and robust to redelivery with a fresh envelope id.
- **`Checkpoint` (P2, `record()`), actual stream only.** **Drop the `%100` gate** — write one
  row per active date (`sk: event.timestamp.slice(0,10)`), idempotent on the date. This makes
  `getTimeTravelAvailability` report the true active-date window instead of under-reporting it
  (the actual `getPortfolioAt` replay reads `SnapshotAt` rows, which exist for every event).
  `event.timestamp` is the published envelope timestamp (processing time), the only timestamp
  the consumer receives — so the checkpoint date is the processing date.
- **Simulation P1 projections** (`projectVersioned('Simulation' / 'SimulationPosition')`):
  unchanged.

`HistoryEntry` and `Checkpoint` remain `Projection<'P2'>` in `read-model-ownership.ts` —
no registry change; both keep using `record()`, matching P2 enforcement.

### Part B — cleanup + typecheck

- Delete the 7 dead write methods + 4 dead read methods from `portfolio.repository.ts`,
  leaving the 5 live read methods. Removes the 5 `TableEntry.timestamp` errors.
- Align the 3 transform signatures (`balanceUpdated`, `portfolioUpdated`,
  `ledgerEntryRecorded`) to `toUow`'s return type — widen the param to
  `UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>` (the second arg,
  the context, is what mismatches: `toUow` returns `Record<string, unknown>` while the
  transforms default it to `RequestContext`). Inside each, narrow the now-`Record` context
  with a local `event.context as { tenantId: string; userId?: string; region?: string }`.
  This resolves the `event-listener.ts` call-site error.
- Resolve any remaining `tsc --noEmit` errors in `src` (legacy test-file casts handled as
  the tests in those files are rewritten/pruned).
- Add a `typecheck` target to `services/ledger/ledger-bff/project.json` (the `typecheck`
  `targetDefault` is already registered workspace-wide); get it green.

### Tests

- Rewrite `test/unit/transforms/ledger-entry-recorded.test.ts` to inject the **real producer
  shape** (`{ tenantId, streamType, lastEventSequence, snapshot }` + envelope) and assert: a
  non-colliding `HistoryEntry` sk, populated `eventType`/`createdAt`/`sequenceNo`, and a
  per-date `Checkpoint`. This is the regression coverage for the bug.
- Align `test/integration/ledger-bff.integration.test.ts` fixtures to the real producer shape
  so the gap stays test-visible.
- Prune `test/unit/repositories/portfolio.repository.test.ts` cases for deleted methods; keep
  coverage of the 5 live read methods.

## Out of scope

- **"Order history" semantics.** `eventType` is the generic `"LEDGER_ENTRY_RECORDED"` and
  `payload` is the snapshot summary, because the producer derives entries from snapshot diffs,
  not from the originating `ORDER_FILLED`/`DEPOSIT_DETECTED` cause. A semantically rich order
  history sourced from Execution-domain order events is a separate cross-domain concern — file
  as a backlog finding during execution.
- **ledger-ctrl's own latent tsc errors** (`ledger-ctrl-2-latent-tsc-errors`) — separate file;
  the `TableEntry.timestamp` fix likely shares a root cause but is not bundled here.
- **dashboard-bff / advisory residuals** (`dashboard-advisory-readmodel-fixes`) and
  **investor-bff tsc errors** (`investor-bff-13-latent-tsc-errors`) — separate QUEUED files.
- **Re-widening any event contract** beyond what is described (Part A touches no producer).

## Validation gate

- `pnpm nx run ledger-bff:typecheck` green (new target).
- `pnpm nx affected -t test,lint` green.
- Deploy `ledger-bff` to dev; `pnpm nx run ledger-bff:test-integration` green against deployed dev.
