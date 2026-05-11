---
id: reconciliation-ctrl-idempotency-race-under-parallel-load
status: queued
rank: 1
type: bug
notes: "P1 production correctness: reconciliation-ctrl emits duplicate RECONCILIATION_COMPLETED when two PORTFOLIO_UPDATED events with the same eventId arrive under load. Surfaced by --parallel=4 integration run during Lever 1+3 final measurement (2026-05-12)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# reconciliation-ctrl: duplicate RECONCILIATION_COMPLETED emitted under parallel load

## Symptom

`services/ledger/reconciliation-ctrl/test/integration/reconciliation-ctrl.resilience.integration.test.ts:86` failed during the integration-suite Lever 1+3 final measurement at `--parallel=4`:

```
expect(reconEvents).toHaveLength(0);

Expected length: 0
Received length: 1
Received array:  [{
  "detailType": "RECONCILIATION_COMPLETED",
  "detail": {
    "subject": {
      "reconciliationId": "recon-idemp-35189b19-edc7-4905-b92a-e54958e85988",
      ...
    },
    ...
  }
}]
```

Test setup: publishes `PORTFOLIO_UPDATED` with eventId X, captures the resulting `RECONCILIATION_COMPLETED`, then publishes a duplicate `PORTFOLIO_UPDATED` with the same eventId X. Expects 0 duplicate `RECONCILIATION_COMPLETED` events. Got 1.

Same suite passes at `--parallel=2` (verified in same session).

## Why this is a production-correctness issue (not a flake)

EventBridge guarantees at-least-once delivery. SQS retries on Lambda partial failure. A user double-clicking a UI trigger produces two identical events. Each of these mechanisms is normal — the system must dedup. The test asserts that dedup; under `--parallel=4` contention the dedup races.

Concrete production failure modes:
1. **User double-click on "rebalance"** → 2 `PORTFOLIO_UPDATED` events → 2 `RECONCILIATION_COMPLETED` → 2 reconciliation rows → potentially 2 sets of trade orders.
2. **EB redelivery on Lambda timeout** → same event re-fired → duplicate `RECONCILIATION_COMPLETED`.
3. **SQS visibility timeout expiry while Lambda is mid-flight** → re-invoked with same SQS message → duplicate.

## Suspected root cause (untested)

The handler's idempotency mechanism likely uses a DDB `attribute_not_exists` conditional write or an in-memory cache. Under contention, two concurrent invocations may both pass the "not yet written" check before either commits. Need to verify by reading the handler.

## Investigation steps

1. Read `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts` (or wherever the reconciliation row is created) — find the dedup logic.
2. Check whether the conditional-write uses a unique key per eventId (correct) or a derived key that could collide (wrong).
3. CloudWatch Logs for the two failed-test Lambdas — check the two invocations' timestamps and decision paths.
4. If conditional-write is correct, look upstream: the SQS partial-batch-failure path may be re-driving an already-committed message.

## Validation gate

After fix:
- Single test run at `--parallel=4` green twice in a row.
- A targeted concurrency test: publish 10 identical duplicate `PORTFOLIO_UPDATED` events within 100ms; assert exactly 1 `RECONCILIATION_COMPLETED`.

## Why this matters more than the workstream that found it

This is a production correctness bug. The integration-suite-slowness workstream found it as a side-effect of running at higher parallelism. Fix this before adopting `--parallel=4` as the default CI cadence — otherwise CI flakes will mask real regressions of the same shape.
