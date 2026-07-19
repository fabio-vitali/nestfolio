---
id: e2e-feature-tests-hand-rolled-polling-not-using-poll-helper
status: parking
type: refactor
notes: "5 e2e-feature-tests scenario files hand-roll Date.now()+N polling while-loops instead of using the shared poll() helper exported from src/index.ts."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# e2e-feature-tests: 5 scenario files hand-roll polling instead of using the shared poll() helper

## Evidence (audit-e2e-test judgment check, surfaced 2026-07-19 by the pre-ship deploy-gate on backlog item e2e-fixtures-test-stale-detail-envelope-assertion — unrelated to that item's own fix)

Convention drift: the suite exports and elsewhere uses a shared `poll()` helper for polling with timeout, but five test files hand-roll `Date.now() + N` while-loops with inline `setTimeout` instead of using `poll()`, duplicating the polling primitive inconsistently across the suite.

`grep 'Date.now() +'` matches:
- `src/profile/update-operating-mode.e2e.test.ts`
- `src/account/circuit-breaker-lifecycle.e2e.test.ts`
- `src/advisory/operating-mode-authority.e2e.test.ts`
- `src/advisory/operating-mode-recommendation-shape.e2e.test.ts`
- `src/advisory/reconciliation-correction.e2e.test.ts`

cf. `src/helpers/poll.ts`, exported from `src/index.ts`.

## Cheapest next step

Replace each hand-rolled loop with a call to the shared `poll()` helper.
