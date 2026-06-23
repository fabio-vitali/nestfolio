---
id: ledger-bff-order-history-generic-eventtype
status: parking
type: bug
notes: "getOrderHistory shows generic LEDGER_ENTRY_RECORDED rows (snapshot-summary payload), not real order events — producer derives entries from snapshot diffs."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
epic: bff-read-model-semantic-gaps
epic_role: core
---

# getOrderHistory shows generic LEDGER_ENTRY_RECORDED entries, not real order events

ledger-bff's `getOrderHistory` resolver (`src/graphql/js-function/get-order-history.fn.js`)
reads `HistoryEntry` rows materialized from `LEDGER_ENTRY_RECORDED` by
`src/transforms/ledger-entry-recorded.ts`. After `ledger-bff-readmodel-fixes` those rows
materialize correctly, but:

- `eventType` is always the generic envelope detail-type `"LEDGER_ENTRY_RECORDED"`.
- `payload` is a snapshot summary `{ cashBalanceCents, positions, lastEventSequence }`.

because the producer — `services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts`
(`LedgerEntryEvent`) — derives entries from `AccountSnapshot` diffs, NOT from the originating
`ORDER_FILLED` / `DEPOSIT_DETECTED` / `CORPORATE_ACTION_APPLIED` cause. So the "order history"
UI cannot show real order details (symbol / qty / price / side); it can only show "a ledger
entry was recorded" with the resulting balances.

**Cheapest next step:** a semantically rich order history must source from Execution-domain
order events (cross-domain wiring — likely a new ledger-bff subscription to `ORDER_FILLED`
etc., or carrying the originating cause forward through `LEDGER_ENTRY_RECORDED`). Needs a
design pass.

**Why parking (not folded into the read-model refactoring QUEUED set):** the `HistoryEntry`
row is correctly P2-owned and now materializes correctly — the single-writer ownership model
is satisfied. This is a downstream feature/semantic gap, not an ownership/materialization
correctness issue, so it is not required for the read-model-ownership refactoring to be
complete. Surfaced 2026-06-03 during `ledger-bff-readmodel-fixes`. See [[project_read_model_redesign]].
