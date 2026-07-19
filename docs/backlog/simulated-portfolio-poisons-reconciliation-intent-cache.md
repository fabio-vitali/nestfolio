---
id: simulated-portfolio-poisons-reconciliation-intent-cache
status: parking
type: bug
notes: "reconciliation-ctrl caches every PORTFOLIO_UPDATED as reconciliation intent with no streamType guard, risking spurious drift detection off simulated data."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Simulated portfolio events poison the reconciliation intent cache

`services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts:173-177` caches every
`PORTFOLIO_UPDATED` as the reconciliation intent side with no `streamType` guard, risking spurious
drift detection and a real Step-Functions rebalance triggered off hypothetical simulation data.
Same root cause as [[simulated-portfolio-corrupts-real-balance-readmodel]].
