---
id: integration-coverage-backfill
status: parking
type: epic
notes: "Behaviors covered only by e2e/unit/manual lack a fast integration regression test. Debt-class theme epic (same backfill action), 3 members."
done_when: "Each in-scope behavior gains a fast integration regression test at the right layer; all members shipped or dropped."
scope: "Integration-test coverage gaps — a shipped behavior whose only regression coverage is e2e, unit, or manual smoke."
out_of_scope:
  - "e2e-suite-blocking gaps (those are status:queued per the e2e-gaps-queued-not-parking rule) and broadcast-delivery coverage (live-push-broadcast-coverage)"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Integration-coverage backfill

Root cause (debt class): features shipped with only e2e/unit/manual coverage and no fast integration regression test, so a regression is caught late (post-deploy) or not at all. Honest caveat — the behaviors differ; the shared trigger is 'no integration-layer regression test'. Fix pattern: add the missing integration test at the right layer.

Members (derived from `epic:` pointers):
- `dashboard-getdashboard-missing-row-integration-test` (missing-row guard, today only e2e-covered)
- `advisory-phase-ab-integration-coverage` (Phase A SF state + Phase B Memory, unit+manual only)
- `advisory-riskcategory-compliance-coverage` (non-MODERATE riskCategory → suitability outcome, a newly-reachable path)
