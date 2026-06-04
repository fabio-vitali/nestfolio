---
id: advisory-generating-state-e2e-accumulate-model-stale
status: shipped
rank: 3
type: feature
notes: "WS-3 of advisory-generating-failed-ux: advisory-mfe renders generating + failed decision-cycle states (status-routed off DecisionReadModel) + staleness guard; rewrites the /advisory Playwright scenario that encoded the removed accumulate model; removes the dead lastTriggerAt/displayedInFlightCount plumbing."
references:
  - docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md
  - apps/advisory-mfe/src/app/decision-list/decision-list.component.ts
  - apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts
  - services/advisory/advisory-bff/src/graphql/js-function/get-pending-decisions.fn.js
out_of_scope:
  - "WS-4 dashboard reflection (generating/failed indicator + the second e2e test retarget) — tracked by dashboard-generating-failed-reflection (rank 4)."
  - "Migrating inject-advisory-update.ts off the direct @aws-sdk/client-eventbridge import — tracked by nestfolio-e2e-eventbridge-client-wrapper-migration."
  - "Post-packet failure surfacing (BLOCKED/REJECTED are existing decision statuses, unchanged)."
  - "Any AdvisoryStatus read-model field additions — the row-backed status approach avoids them."
  - "Real full agent-pipeline e2e (injected events only, for determinism + cost)."
spec: docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md
plan: docs/superpowers/plans/2026-06-04-advisory-generating-state-ws3.md
topic_memory: []
validation_gate: |
  Shipped on branch worktree-advisory-generating-state-e2e-accumulate-model-stale
  (commits c71c125b..ab06c76f). Key commits: f84b9b8d (getPendingDecisions filter
  +GENERATING/+FAILED), 35ab432d (full AppSync AdvisoryStatus surface removed —
  Option C, deep-verified zero-consumer), e167988b (advisory-mfe status-routing +
  6-min staleness guard), 1c349442 (component tests 113/113), db86bd99 (i18n
  failedTitle/failedHint), 83541fd8 (e2e rewrite + WS-4 skip), ab06c76f
  (trigger='' fix for getPendingDecisions String! — e2e-discovered bug).
  Gates:
  - `nx affected -t test,lint --base=origin/main` → Successfully ran for 35 projects (0 errors).
  - read-model drift gate → OK (0 drift).
  - Deployed advisory-bff + investor-web + advisory MFE bundle + shell i18n to dev
    (Ingress Lambda updated 2026-06-04T22:41:49Z with the trigger fix).
  - advisory-bff integration vs dev → 10/10 passed (cycle-status + inFlightCount recompute).
  - Scoped Playwright `advisory generating` vs dev → 2 passed (generating→failed;
    generating→packet-clears) + 1 WS-4 skip, TWICE consecutively (anti-flake).
  e2e caught a real bug unit tests missed: cycle-status rows had no `trigger` but
  getPendingDecisions selects DecisionPacket.trigger as String! → list query failed,
  /advisory showed the error state. Fixed by writing trigger='' in the cycle-status
  transform + a regression unit test.
---

# WS-3 — advisory-mfe generating + failed UX (+ /advisory e2e)

Part of the `advisory-generating-failed-ux` mini-program (design umbrella:
`docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md`, §5 + §7.3
test 1). Depends on WS-1 (DWC emits cycle events) + WS-2 (advisory-bff projects
GENERATING/FAILED onto DecisionReadModel) — ranks 1–2.

Scope:
- `get-pending-decisions.fn.js` (+ the `PENDING_STATUSES` mirror in the component):
  include `GENERATING` + `FAILED` so those rows reach the UI.
- `decision-list.component.ts`: route rows by status — real decisions → list;
  `GENERATING` → spinner (banner when the list is non-empty, full empty-state
  `data-testid=advisory-generating-state` when empty); a recent `FAILED` row →
  new `data-testid=advisory-failed-state` error; plus a client-side staleness
  guard (a `GENERATING` row older than the agent-budget ceiling renders as failed
  — covers uncatchable `States.Runtime` failures that emit no event).
- Remove the dead `lastTriggerAt` / `displayedInFlightCount` plumbing (component;
  and the now-unused BFF `lastTriggerAt` field path if nothing else reads it).
- i18n: `advisory.list.failedTitle` / `failedHint`.
- Rewrite `advisory-generating-state.spec.ts` test 1: inject
  `DECISION_CYCLE_STARTED` → spinner; `DECISION_CYCLE_FAILED` → error; a content
  `DECISION_PACKET_CREATED` → the decision appears + spinner clears (UI-only).
- Component unit tests for each state.

Supersedes the original "the e2e test encodes the removed accumulate model"
finding: the test is fixed by building the real generating/failed UI it should
assert. Validation: deploy investor-web + scoped Playwright vs dev.
