---
id: advisory-generating-failed-ux-design
status: shipped
type: design
notes: "Design umbrella for the advisory generating + failed decision-cycle UX mini-program: a cycle-start signal from decision-workflow-ctrl, version-guarded GENERATING/FAILED status on the DecisionReadModel row, /advisory + /dashboard rendering. Decomposed into WS-1..WS-4 (queued)."
references:
  - docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md
out_of_scope: []
spec: docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md
plan: null
topic_memory: []
validation_gate: |
  Design-only (Doc-layer) workstream. Deliverable: the design spec
  docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md, reviewed
  + approved, decomposing the feature into a curated QUEUED set (WS-1
  advisory-dwc-cycle-lifecycle-events, WS-2 advisory-bff-cycle-status-projection,
  WS-3 advisory-generating-state-e2e-accumulate-model-stale, WS-4
  dashboard-generating-failed-reflection) such that draining QUEUED completes the
  feature. No code; each WS carries its own implementation + validation gate.
---

# Advisory generating + failed decision-cycle UX — design umbrella

The advisory "generating" UX is dead post-workstream-3 (`lastTriggerAt` never
persisted; the empty-state unreachable because `inFlightCount` counts existing
rows), and a decision cycle that fails shows the user nothing. The fix needs a
cycle-start signal that exists *before* any decision row.

Design (see the spec for full detail): decision-workflow-ctrl emits
`DECISION_CYCLE_STARTED` at SF-start and `DECISION_CYCLE_FAILED` on a catchable
SF failure; advisory-bff projects these as a version-guarded `GENERATING`/`FAILED`
status on the `DecisionReadModel` P1 row (idempotent, order-agnostic); the
advisory + dashboard MFEs render generating/failed/list states, with a UI
staleness guard for uncatchable `States.Runtime` failures.

Decomposed into a mini-program (drain QUEUED ⇒ complete):

- **WS-1** `advisory-dwc-cycle-lifecycle-events` (rank 1) — spec §3.
- **WS-2** `advisory-bff-cycle-status-projection` (rank 2) — spec §4.
- **WS-3** `advisory-generating-state-e2e-accumulate-model-stale` (rank 3) — spec §5 + §7.3 test 1.
- **WS-4** `dashboard-generating-failed-reflection` (rank 4) — spec §6 + §7.3 test 2.
