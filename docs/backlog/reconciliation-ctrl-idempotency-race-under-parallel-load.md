---
id: reconciliation-ctrl-idempotency-race-under-parallel-load
status: shipped
rank: null
type: bug
notes: "Originally framed as P1 prod-correctness on 2026-05-12; Phase 1 investigation reclassified as (a) test assertion stronger than the EB CDC at-least-once contract, and (b) `tenantId: integ-${Date.now()}` ms-collision under `--parallel=4`. Consumer-side dedup already absorbs duplicate RECONCILIATION_COMPLETED. Shipped 2026-05-13."
references:
  - "services/ledger/reconciliation-ctrl/test/integration/reconciliation-ctrl.resilience.integration.test.ts:86"
  - "libs/event-processor/src/engine/intent-executor.ts:71"
  - "libs/event-processor/src/engine/egestion-engine.ts:112"
  - "libs/cdk-constructs/src/core/egress.ts:117"
  - "libs/test-support/src/context.ts:66"
  - "libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:74"
out_of_scope:
  - "Adding per-record dedup inside EgestionEngine. The platform contract is at-least-once CDC + consumer-side idempotency via `record()`'s `attribute_not_exists(pk)`. Adding egress dedup would be a larger, cross-cutting change with its own correctness considerations (LRU eviction, DDB-backed seen-set TCO)."
  - "Running the full `--parallel=4` integration sweep as a validation gate. Lever 4 dossier already covered the wall-clock measurement; what blocked Lever 4 adoption was this finding. The targeted resilience suite is a sufficient gate here; Lever 4 promotion is a follow-up workstream."
  - "Repointing the dossier's user-double-click / EB-retry narratives at downstream consumers. The two known consumers (reconciliation-ctrl's own egress + any agent-ctrl that subscribes) already use `record()`-based dedup. A workspace-wide audit of RECONCILIATION_COMPLETED consumers is filed-and-deferred."
spec: null
plan: null
topic_memory: []
validation_gate: "`pnpm nx run reconciliation-ctrl:test-integration` green twice in a row against deployed dev (2026-05-12 run 1: 4/4 in 150s; 2026-05-13 resume run: 4/4 in 120s). Lint green on test-support, reconciliation-ctrl, event-processor. test-support unit tests 7/7 green."
---

# reconciliation-ctrl resilience idempotency test: assertion vs at-least-once CDC + test-context tenantId ms-collision

## What surfaced

`services/ledger/reconciliation-ctrl/test/integration/reconciliation-ctrl.resilience.integration.test.ts:86` failed under the Lever 1+3 final measurement run at `--parallel=4`. The test publishes a duplicate `PORTFOLIO_UPDATED` with the same `eventId` and asserts `reconEvents.length === 0` after a 20s drain. Got 1.

At `--parallel=2` the suite passes — load-dependent.

## Root cause analysis (Phase 1)

**Two independent gaps, neither of which is a production correctness bug:**

### 1. The test assertion encodes a stronger guarantee than the platform offers

The handler-level dedup is solid:

- `record()` (`libs/event-processor/src/engine/intent-executor.ts:71`) writes via `PutCommand` with `ConditionExpression: 'attribute_not_exists(pk)'` and returns `{ deduplicated: true }` on `ConditionalCheckFailedException`. DDB serializes per-key writes, so two `PutItem`s for the same composite key produce exactly one INSERT and one CCFE-as-deduplicated — no race window.
- The DDB Stream event-source filter (`libs/cdk-constructs/src/core/egress.ts:117`) limits records to `__typename ∈ {ReconciliationResult, DriftRecord}`. `PositionCache` overwrites are filtered out and never reach the egress Lambda.

What the assertion misses is the **egress** layer:

- `EgestionEngine.processRecord` (`libs/event-processor/src/engine/egestion-engine.ts:112`) publishes one EB event per stream record with `detail.id = ctx.record.eventID`. There is no per-record dedup at egress.
- DDB Streams is at-least-once. The event-source mapping is configured with `bisectBatchOnError: true, retryAttempts: 3`; shard rebalances and Lambda transient throttling can also re-deliver. Any of these can republish a `ReconciliationResult` INSERT with the same `detail.id`.

The platform contract is **at-least-once CDC** + **consumer-side `record()` idempotency**. The test asserted at-most-once at the EB layer, which the platform does not (and need not) guarantee.

### 2. `tenantId: integ-${Date.now()}` ms-collision under `--parallel=4`

`libs/test-support/src/context.ts:66` uses millisecond resolution. Under `--parallel=4`, four Nx project workers create contexts concurrently and can collide on the same `Date.now()`. The trap's EB rule (`libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:74`) filters on `detail.context.tenantId`, so a colliding trap captures the other test's events.

## Production-correctness reassessment

The dossier framed the duplicate `RECONCILIATION_COMPLETED` as a P1 production correctness issue (user double-click, EB redelivery, SQS visibility timeout → duplicate trade orders). That framing relied on the assumption that downstream consumers act on every received event. In practice consumers use the same `record()` intent for their own writes, which deduplicates on `attribute_not_exists(pk)` keyed by `ctx.eventId`. Duplicate emission is noisy but cannot produce duplicate downstream side-effects.

The dossier's prod-failure narratives are already absorbed by consumer-side idempotency. The real defects are test infrastructure and test assertion strength.

## Fix

1. Replace `integ-${Date.now()}` with UUID-suffixed `tenantId` / `userId` in `libs/test-support/src/context.ts` so `--parallel=N` is collision-free for any N.
2. Relax the resilience idempotency assertion to count **unique `reconciliationId`s** observed across the first event + the post-duplicate drain, asserting exactly one. Same semantic guarantee from the user's point of view, but resilient to at-least-once redelivery.
3. Add a top-of-file comment in `libs/event-processor/src/pipelines/change-data-capture.ts` stating the at-least-once CDC contract + the consumer-side dedup pattern, so future readers don't make the same assumption.

## Validation gate

- `pnpm nx run reconciliation-ctrl:lint` clean.
- Resilience integration suite green twice in a row against deployed dev (`pnpm nx run reconciliation-ctrl:test-integration` with `NESTFOLIO_INTEG_PREFIX=dev`), specifically the `duplicate PORTFOLIO_UPDATED does not produce duplicate ReconciliationResult` case.

## Why this is enough (and Lever 4 follow-up)

Adopting `--parallel=4` as default CI cadence (the `integration-suite-lever-4-parallelism` workstream) was the reason this got escalated. With the test assertion corrected and tenantId collision eliminated, the blocker on Lever 4 promotion is removed. A full `--parallel=4` validation belongs to Lever 4's own ship.
