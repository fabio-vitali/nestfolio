---
id: happy-path-decision-sf-waitfortasktoken-wedge
status: shipped
type: bug
rank: 5
notes: "new-investor-happy-path e2e red at decision step. ROOT CAUSE CONFIRMED 2026-06-16 (NOT the filed .waitForTaskToken/maxVms hypothesis): advisory-bff decision transforms read tenantId from the now-DRY CDC subject → DecisionReadModel written to Decision#undefined#… → decision never advances past GENERATING → pendingDecisions stays 0. Fix: read identity from context; +States.Runtime trigger fix; +systemic guard."
references:
  - services/advisory/advisory-bff/src/transforms/decision-snapshot.ts
  - services/advisory/advisory-bff/src/transforms/decision-cycle-status.ts
  - libs/event-processor/src/pipelines/change-data-capture.ts
  - services/investor/dashboard-bff/src/transforms/advisory-status.ts
  - services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
out_of_scope:
  - "Cleaning up the existing Decision#undefined#… garbage rows + stale RUNNING SF execs in dev (disposable dev data; superseded on next cycle — stale execs stopped only as e2e-run hygiene)"
  - "The broader read-model-ownership producer-aggregates program (this is a single isolated consumer-identity bug)"
  - "e2e scenarios beyond new-investor-happy-path"
spec: null
plan: null
topic_memory:
  - project_decision_workflow_stuck.md
validation_gate: |-
  Root cause (advisory-bff keyed DecisionReadModel off the DRY subject's tenantId → Decision#undefined#…)
  fixed across 3 commits: c7f361bf (decision-snapshot + decision-cycle-status read tenantId from context;
  co-wrong fixtures corrected; regression added), 6786b7d7 (DWC ResolveInvestorProfile predicate guards the
  uncatchable States.Runtime), 84c9e4e1 (subject-identity gate + 4 nestfolio identity-read fixes + 2 boundary
  exclusions). Unit+lint GREEN for all 20 affected projects (nx run-many -t test,lint); check-typed-subjects
  gate self-test 20/20 + full-tree scan 0 violations; check-service-card-drift 0 drift. Deployed 5 services to
  dev (compliance-ctrl/portfolio-engine-ctrl/advisory-narrative-ctrl/advisory-bff/decision-workflow-ctrl, all ✅,
  Lambda-only); live SF verified to carry the tightened ResolveInvestorProfile predicate (no stale bundle).
  E2E (apps/nestfolio-e2e new-investor-happy-path, deployed dev): the decision WEDGE IS RESOLVED — step 8
  (waitForPendingDecisionsAtLeast, the previously-failing gate) + steps 9-10 (open decision, non-empty
  rationale, confirm) all PASS (all previously unreachable); journey reached go-live (step 11) for the first
  time. Step 11 (execution-mode-live badge) fails on a SEPARATE, unmasked root cause filed as
  happy-path-go-live-badge-stuck-sim (queued). Done re-scoped per user direction 2026-06-16: the decision-wedge
  fix ships here; the go-live badge is split off as its own item.
---

# Decision-workflow SF wedged at `.waitForTaskToken` — blocks the happy-path Playwright e2e

The `apps/nestfolio-e2e` `new-investor-happy-path` journey is **red at the decision step**
(`DashboardPage.waitForPendingDecisionsAtLeast`, `apps/nestfolio-e2e/src/pages/dashboard.page.ts:35`):
the advisory cycle never produces a pending decision, so the dashboard stays in
`dashboard.advisory.generatingTitle` with `pendingDecisions: 0`. This blocks `nestfolio-e2e`
from being green (e2e-gaps-queued ⇒ queued).

## ⚠ ROOT CAUSE CONFIRMED 2026-06-16 — the filed hypotheses below are DISPROVEN

Traced end-to-end against deployed dev. The wedged SF execs are **not** stuck at an agent-invoke
`.waitForTaskToken` (those carry a 120s `TimeoutSeconds`); they reach `RequestUserConfirmation`
(a DynamoDB `updateItem.waitForTaskToken`, 72h timeout, **holds no micro-VM**) — so the "no-timeout"
and "maxVms-cascade" theories are both wrong. The SF runs perfectly to `AWAITING_CONFIRMATION`.

The real bug: **advisory-bff `decision-snapshot.ts` (and sibling `decision-cycle-status.ts`) build
the read-model key from the event SUBJECT** — `pk: Decision#${p.tenantId}#…` where `p = uow.event.subject`.
The 2026-06-08 DRY-subject migration moved `tenantId`/`userId`/`region` out of CDC subjects into the
envelope **context** (`changeDataCapture` `buildSubject` → `schema.parse(record)` drops identity). So
`p.tenantId` is now `undefined`, and every `DECISION_PACKET_CREATED/UPDATED` projects to
**`Decision#undefined#<decisionId>`** (this garbage row exists in dev now with the real content:
`AWAITING_CONFIRMATION`, 866-char explanation, 6 trades). The real `Decision#<tenant>#<decisionId>` row
stays frozen at the `GENERATING` v0 stub written by `decision-cycle-status` from `DECISION_CYCLE_STARTED`
(whose SF-built subject still redundantly carries `tenantId`). → advisory-bff `AdvisoryStatus.inFlightCount=0`
→ dashboard `pendingDecisions: 0`. Classic co-wrong-fixture bug ([[event-subject-contracts]]): consumer
type + unit fixtures still claim `tenantId` is in the subject (integration green); only e2e vs the real DRY
producer exposes it.

**Fix (this workstream):** (1) `decision-snapshot.ts` + `decision-cycle-status.ts` read `tenantId` from
`uow.event.context` (matching dashboard-bff `advisory-status.ts`); correct the co-wrong fixtures + add a
regression test asserting the row lands at `Decision#<tenant>#…`. (2) Fix the separate uncatchable
`States.Runtime` at `HoistInvestorProfileFromTrigger` (an `INVESTOR_PROFILE_UPDATED` trigger with `goal`
but no `riskProfile.category`). (3) Add a systemic guard so no consumer transform can derive identity
(tenantId/userId/region) from a DRY subject again. Then deploy advisory-bff + DWC and re-run the e2e.

## Evidence (2026-06-15, deployed dev) — SUPERSEDED, see root-cause section above

- **Symptom is reproducible:** two consecutive Playwright runs failed identically at the decision
  step (~5.1m each), onboarding + deposit succeeding first (dashboard showed cash 9.45M post-deposit).
- **Backend root symptom:** `aws stepfunctions list-executions` on
  `dev-decision-workflow-ctrl-decisionstatemachine` shows many executions stuck in **`RUNNING`** —
  including ones started **10:12** that were still `RUNNING` 2h later (i.e. they predate the
  go-live P4.6 deploy at ~11:53, so this is NOT a go-live regression). `get-execution-history` on a
  stuck exec: last event is `TaskSubmitted` at a `.waitForTaskToken` agent-invocation task with **no
  subsequent `SendTaskSuccess`** → the SF waits forever. Hours-long `RUNNING` execs imply the
  `.waitForTaskToken` task has **no effective `TimeoutSeconds`/`HeartbeatSeconds`** firing (or it was
  removed), so a missed callback wedges the execution permanently and the held micro-VMs cascade into
  maxVms saturation for subsequent cycles.

## Why this is a recurrence (prior fixes shipped, yet it's back)

These all shipped 2026-05-18..22 and did not prevent the current wedge:
`agentcore-maxvms-browser-path-resilience` (idle/lifetime trims + onboarding SSE retry),
`agentcore-invocation-resilience` (retryable quota/throttle reclassification + IP-ctrl tuning),
`agent-pipeline-backlog-trap-impl` / `-architectural` (synth-time three-knob `agentProfile()` invariant),
`agent-pipeline-task-token-timeout-observability` (TaskTimedOut observability).
The previously-`dropped` `decision-workflow-ctrl-sf-stuck-waitforcompliance` diagnosed a *fast-fail*
at InvokeInvestorProfile — the CURRENT signature is different (slow/permanent `.waitForTaskToken`
hang, not a fast-fail), so it is not the same bug.

## Cheapest next steps

1. Inspect the wedged state's task definition: does the `.waitForTaskToken` agent-invoke task in the
   DWC state machine set `TimeoutSeconds`/`HeartbeatSeconds`? If not, add one so a missed callback
   fails fast instead of holding a micro-VM forever (a missing timeout is uncatchable-forever, the
   opposite failure mode of `feedback_states_runtime_uncatchable`).
2. Test the maxVms-cascade hypothesis: stop the stuck `RUNNING` executions (dev), then run ONE
   happy-path journey from a clean VM pool — if it then completes the decision cycle, the wedge is
   stuck-exec/maxVms accumulation (needs a reaper or timeout); if it wedges again from clean, it is a
   genuine agent-invoke→`SendTaskSuccess` callback bug.
3. CloudWatch the agent IngressHandler (PE/IP/MI/AN-ctrl) for the wedged `decisionId`: did the agent
   run and fail to `SendTaskSuccess`, or never start (VM starvation)?

## Relationship to the go-live workstream

The go-live workstream (`go-live-agent-wiring-and-emission`) extended this same journey with a
go-live step + POM (`apps/nestfolio-e2e/src/pages/go-live.page.ts`) that asserts the dashboard
`[data-testid="execution-mode-live"]` badge after `confirmGoLive`. That assertion is **downstream of
this wedge** and was never reached in either run, so it is unexercised. Resolving this wedge (Done =
`new-investor-happy-path` green end-to-end through go-live) re-validates the go-live UI step in the
same pass. Go-live itself is independently validated by the Jest `go-live-switch` e2e (green on dev),
so this item is the UI-truth blocker, not the core go-live coverage.
