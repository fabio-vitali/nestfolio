---
id: ledger-ctrl-version-drift-under-shuffle
status: parking
type: bug
notes: "ledger-ctrl AccountSnapshot.version increments one extra time under at-least-once redelivery: same lastEventSequence (3), different version (3 vs 2). Surfaced by --parallel=8 order-agnostic full-shuffle resilience test (2026-05-13). Real prod-correctness gap symmetric to reconciliation-ctrl content-key fix."
references:
  - "services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts:418"
  - "libs/integration-testing/src/resilience.ts:69"
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
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
