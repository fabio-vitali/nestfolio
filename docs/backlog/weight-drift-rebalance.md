---
id: weight-drift-rebalance
status: parking
type: epic
notes: "No producer emits PORTFOLIO_DRIFT_DETECTED on the weight-deviation axis; the rebalance path + its e2e are blocked on it. Feature + dependent test. Theme epic, 2 members."
done_when: "A producer emits PORTFOLIO_DRIFT_DETECTED on weight deviation and the organic-rebalance e2e covers it; both members shipped or dropped."
scope: "The weight-deviation drift-detection feature and the test/coverage directly blocked on it."
out_of_scope:
  - "Mode-awareness of the rebalance planner (rebalance-planner-mode-awareness — orthogonal to drift detection)"
  - "Intent-vs-settlement reconciliation (already covered by reconciliation-ctrl)"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Weight-drift rebalance trigger

Root cause: the rebalance code path exists (DWC SF starts on PORTFOLIO_DRIFT_DETECTED → PE+AN
produce a rebalance decision → advisory-bff projects it → /advisory renders trades) but nothing
emits PORTFOLIO_DRIFT_DETECTED on the target-weight-vs-current-weight axis. The Playwright
rebalance coverage is blocked on that feature existing (it carries a "promote when
weight-drift-detector ships" trigger — correct while parking).

Members (derived from `epic:` pointers):
- `weight-drift-detector` (the missing detector/emitter — a design decision on where it lives)
- `playwright-rebalance-after-weight-drift-detector` (organic-rebalance e2e, blocked on the above)
