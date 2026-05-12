---
id: ledger-ctrl-version-drift-under-shuffle
status: shipped
type: bug
notes: "RECLASSIFIED + RESOLVED 2026-05-13. Initially filed as a handler-idempotency bug (analogous to reconciliation-ctrl content-key). On investigation, `version` turned out to be an internal optimistic-lock counter (see replay-and-reduce.ts) with NO CDC consumer reading it. The drift is real but cosmetic at the assertion layer. Fixed by adding `version` to DYNAMIC_FIELDS in libs/integration-testing/src/resilience.ts."
references:
  - "services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts:418"
  - "libs/integration-testing/src/resilience.ts:9"
  - "libs/event-processor/src/pipelines/replay-and-reduce.ts:98"
out_of_scope:
  - "Rewriting the version-increment logic in replay-and-reduce.ts. The current `currentVersion + 1` is correct for its purpose (optimistic concurrency control on the reducer); it just happens to drift between equivalent runs. No consumer-visible effect."
spec: null
plan: null
topic_memory: []
validation_gate: "Re-run --parallel=8 integration suite. The ledger-ctrl resilience shuffle test should no longer retry on the version-comparison branch. Other trap-empty retries on this run trace to a different family (cross-file Jest-session / load-induced propagation delay)."
---

# ledger-ctrl AccountSnapshot.version drift under at-least-once redelivery

## Symptom

`ledger-ctrl resilience: order-agnostic full shuffle 3 events in shuffled order produce same final snapshot as sequential` fails intermittently at `--parallel=8` with:

```
assertEquivalentState: snapshots differ
A (1 items): [{... lastEventSequence: 3, version: 3 ...}]
B (1 items): [{... lastEventSequence: 3, version: 2 ...}]
```

Every other field matches exactly (cashBalanceCents, positions, totalValueCents). Only `version` differs: one path incremented it 3 times, the other 2 times. `lastEventSequence` is correctly bounded at 3 in both — so both paths consumed exactly 3 events. The mismatch is at the `version` increment site, which is firing one extra time on redelivered events without consulting `lastEventSequence`.

Passes via `jest.retryTimes(1)` because the second run usually doesn't redeliver.

## Why this is a real prod gap (not just a test issue)

Under at-least-once delivery, every event-applying handler must be idempotent. The pattern here is symmetric to the reconciliation-ctrl content-key fix landed in this workstream: `version` is incremented per HANDLER INVOCATION rather than per LOGICAL STATE TRANSITION. Two invocations from one redelivered event produce one extra increment.

If `version` is read by downstream consumers (BFF subscriptions, optimistic concurrency control, audit) and they expect monotonic-by-state, this drift causes:

- BFF read models out of sync between two reconciliation attempts.
- Optimistic concurrency control on the BFF mutate path failing spuriously after redelivery.

## Investigation steps

1. Read `services/ledger/ledger-ctrl/src/handlers/` — find where `version` is incremented. Confirm whether the increment is gated on `eventSequence > lastEventSequence` (correct) or unconditional (buggy).
2. Repository code for AccountSnapshot — check whether `version` is a separate increment or derived.
3. Decide on fix shape:
   - Option A: gate `version++` on `eventSequence > lastEventSequence` (cheap, surgical).
   - Option B: derive `version` from `lastEventSequence` (eliminates the separate field).
4. Add regression test that simulates the at-least-once redelivery pattern explicitly.

## Cheapest first read

`services/ledger/ledger-ctrl/src/handlers/event-listener.ts` — grep for `version` increments and check guard conditions.

## Resolution

Investigation showed the `version` field is owned by `libs/event-processor/src/pipelines/replay-and-reduce.ts:98` (`nextVersion = currentVersion + 1` per reducer materialization). It's used at line 123 as the optimistic-lock condition (`ConditionExpression: 'attribute_not_exists(pk) OR version = :v'`) so two concurrent reducer invocations on the same group conflict cleanly. Under at-least-once stream delivery, batching is non-deterministic — 3 events may be reduced in 2 batches (`version: 2`) or 3 batches (`version: 3`). Both produce identical semantic state.

No service reads `AccountSnapshot.version` for any consumer behavior. Confirmed via `grep -rn "\.version" services` — the only readers are `broker-sim-adpt/repositories/virtual-ledger.repository.ts` and `broker-sim-adpt/services/simulation-engine.service.ts`, both for *their own local* optimistic locking, not on AccountSnapshot.

Fixed by adding `version` to `DYNAMIC_FIELDS` in `libs/integration-testing/src/resilience.ts` so equivalence comparisons strip it.
