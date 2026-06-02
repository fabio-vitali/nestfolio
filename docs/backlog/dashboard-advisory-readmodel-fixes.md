---
id: dashboard-advisory-readmodel-fixes
status: queued
rank: 7
type: bug
notes: "dashboard-bff + advisory read-model residuals from w2/w3: (A) PositionSnapshot orphan row on full sell (no delete path); (B) AdvisoryStatus dead code + unwritten fields (structural-zero); (C) w3 hardening nits — Date.now() version, terminal taskToken cleanup, WorkflowStatus enum guard. Merges dashboard-position-orphan-on-sell + dashboard-bff-advisory-status-dead-code-cleanup + w3-advisory-versioned-packet-hardening."
references: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
out_of_scope:
  - "The ledger-bff Position projection's identical orphan behavior (w1 reference) — same root pattern; fix the producer-side removal signal once and both inherit it, but track the ledger side under ledger-bff if it needs separate work."
validation_gate: null
---

# dashboard-bff + advisory read-model fixes

Three read-model residuals across dashboard-bff (w2) and advisory (w3), done
together (adjacent surface; WS-C also touches dashboard-bff). Merges three
formerly-separate items. None blocked e2e green.

## A. PositionSnapshot orphan row on full sell (bug)

When a position is fully sold, its symbol disappears from the ledger snapshot's
`positions` map, so the per-symbol
`projectVersioned('PositionSnapshot', …, { sk: 'PositionSnapshot#<symbol>' })` write
is never re-issued — the old row persists (version-correct but stale), and the
holdings list shows a zombie position.
- `services/investor/dashboard-bff/src/transforms/position-snapshot.ts` iterates only
  `Object.entries(snapshot.positions)`; emits nothing for absent symbols.
- Identical in the w1 reference `services/ledger/ledger-bff/src/transforms/portfolio-updated.ts`
  (`Position` P1) — a property of full-row-per-entity P1 projections without a
  removal signal, not a w2 regression.
- **Fix:** producer emits a removal/zeroed entry for sold-out symbols, or a periodic
  reconcile prunes `PositionSnapshot#*` rows absent from the latest snapshot.

## B. AdvisoryStatus dead code + unwritten fields (refactor / structural-zero)

After w3 replaced the dashboard-bff `AdvisoryStatus` accumulate with a P3
projectVersioned of advisory-bff's announcement, three vestiges remain:
1. `DashboardRepository.upsertAdvisoryStatus` is now unused (sole caller was the old
   accumulate path) — `services/investor/dashboard-bff/src/repositories/dashboard.repository.ts:287`;
   two repo unit tests still exercise it. Remove method + tests.
2. `AdvisoryStatus.lastRecommendationAt` + `lastDecisionStatus` are no longer written
   by any producer (P3 row only carries `pendingDecisionsCount`), but the dashboard
   GraphQL type + MFE still declare them = **structural zeros**. Decide: carry them on
   advisory-bff's `ADVISORY_STATUS_UPDATED` payload (it has the decision rows), or drop
   the two fields from schema + MFE.
3. Confirm no remaining `MANDATE_ISSUED` vestige in dashboard-bff (dropped from Ingress
   as an orphan in w3).
- **Next step:** grep `upsertAdvisoryStatus|lastRecommendationAt|lastDecisionStatus|MANDATE_ISSUED`
  across `services/investor/dashboard-bff` + `apps/dashboard-mfe`; remove (1)+(3); (2) is a product decision.

## C. w3 versioned-DecisionPacket hardening nits (refactor)

From the w3 final review (APPROVE-WITH-NITS):
1. **AdvisoryStatus P3 version uses `Date.now()`** —
   `services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts`. Two
   stream records in the same ms → equal version → the `#__version < :version` guard
   drops the second. Self-healing but a same-ms collision can drop the fresher count.
   Prefer a strictly-monotonic version (DDB stream `SequenceNumber`, or
   `Date.now()*1000 + perBatchIndex`). (Same version-footgun class WS-B fixes for
   producers — keep the approach consistent.)
2. **`taskToken` retained on terminal rows** — `decision-workflow-ctrl/src/handlers/sfn-callback.ts`
   sets `CONFIRMED|REJECTED` without `removes:['taskToken']`; dead data on a terminal
   row. Add the removal.
3. **`WorkflowStatus` union has unreachable members** —
   `decision-workflow-ctrl/src/domain/models.ts` still lists
   `INITIATED|PROFILING|CONSTRUCTING|NARRATING|PROPOSED|COMPLIANCE_REVIEW|FAILED`; none
   reach `DecisionReadModel` post-w3. Narrow the union to the 6 enum-valid values (or
   add a status-enum guard in `decision-snapshot.ts`) to make the `status: DecisionStatus!`
   contract provable rather than incidental.

See [[project_read_model_redesign]].
