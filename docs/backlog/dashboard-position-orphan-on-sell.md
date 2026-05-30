---
id: dashboard-position-orphan-on-sell
status: parking
type: bug
notes: "Fully-sold holding leaves a stale PositionSnapshot#<symbol> row in dashboard-bff (no delete path); shared with ledger-bff Position (w1), NOT a w2 regression."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# dashboard-bff PositionSnapshot orphan row on full sell

Surfaced during `bff-readmodel-w2-dashboard-bff`. When a position is fully sold,
its symbol disappears from the ledger snapshot's `positions` map, so the
per-symbol `projectVersioned('PositionSnapshot', …, { sk: 'PositionSnapshot#<symbol>' })`
write is never issued again — the old row persists (version-correct but stale).
The dashboard holdings list shows a zombie position until a tombstone/delete or
reconcile sweep is added.

Evidence:
- `services/investor/dashboard-bff/src/transforms/position-snapshot.ts` — iterates
  only `Object.entries(snapshot.positions)`; emits nothing for symbols absent from
  the latest snapshot.
- Identical behavior in the w1 reference `services/ledger/ledger-bff/src/transforms/portfolio-updated.ts`
  (`Position` P1 projection) — this is a property of full-row-per-entity P1
  projections without a removal signal, **not** introduced by w2.

Cheapest fix path: have the producer emit a removal/zeroed snapshot entry for
sold-out symbols, or add a periodic reconcile that prunes `PositionSnapshot#*`
rows whose symbol is absent from the latest snapshot. See [[project_read_model_redesign]].
