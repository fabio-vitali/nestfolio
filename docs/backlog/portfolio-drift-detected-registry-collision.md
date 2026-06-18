---
id: portfolio-drift-detected-registry-collision
status: parking
type: bug
epic: typed-test-fixtures
epic_role: captured
notes: "PORTFOLIO_DRIFT_DETECTED deferred from typed-fixtures registration — one detailType, two incompatible producer shapes (settlement-drift vs weight-drift); flat registry can't hold both."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# PORTFOLIO_DRIFT_DETECTED — typed-fixtures registry name collision (deferred)

Surfaced 2026-06-18 by **typed-test-fixtures Phase 4 (ledger)**. `PORTFOLIO_DRIFT_DETECTED`
was deliberately **NOT** registered in the typed-fixtures `EventSubjects` registry because the
detailType is **overloaded across two incompatible producer intents**:

- **Settlement drift (real today).** `reconciliation-ctrl` *produces* it via `DriftRecord` CDC
  with `DriftRecordSchema = { reconciliationId, instrument, intentQty, settlementQty, drift }`
  on the **ledger** bus.
- **Weight drift (synthetic, unbuilt).** `decision-workflow-ctrl` integration
  (`decision-workflow-ctrl.integration.test.ts` ~L245) + the advisory e2e fixtures
  (`apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts` ~L61,
  `…/reconciliation-correction.e2e.test.ts` ~L75) inject a **different** shape
  `{ portfolioId, driftPercentage, driftDirection, detectedAt }` on the **advisory** bus to
  drive the rebalance-trigger path — a shape **no producer emits today** (the
  `weight-drift-detector` is unbuilt; see `[[weight-drift-rebalance]]`).

One `detailType` → two producer schemas. The flat `detailType → schema` `EventSubjects` registry
cannot hold both without a source/bus discriminant — the **same class as the deferred
`ORDER_REJECTED` collision** (execution-ctrl `OrderSchema` vs broker-ctrl `NormalizedOrderEventSchema`)
recorded in `[[typed-test-fixtures-execution-deferred-cross-domain]]`. Registering it to
`DriftRecordSchema` would make the dwc/e2e weight-drift fixtures un-correctable-to-green. Its
`putEvent({ detail })` sites therefore stay legacy (gate-invisible, unregistered).

**Promote when** the collision resolves — e.g. `weight-drift-detector` ships (the weight-drift
fixtures become real, with their own producer-owned schema and home), and/or the typed-fixtures
registry gains a source/bus discriminant so two schemas can co-exist under one detailType. Captured
under the `typed-test-fixtures` epic (does not block its closure).
