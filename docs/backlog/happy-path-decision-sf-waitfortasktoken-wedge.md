---
id: happy-path-decision-sf-waitfortasktoken-wedge
status: queued
type: bug
rank: 5
notes: "new-investor-happy-path e2e red at decision step: decision-workflow SF wedged at .waitForTaskToken (callback never fires), recurs post maxVms/backlog-trap fixes. Blocks nestfolio-e2e green."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_decision_workflow_stuck.md
validation_gate: null
---

# Decision-workflow SF wedged at `.waitForTaskToken` — blocks the happy-path Playwright e2e

The `apps/nestfolio-e2e` `new-investor-happy-path` journey is **red at the decision step**
(`DashboardPage.waitForPendingDecisionsAtLeast`, `apps/nestfolio-e2e/src/pages/dashboard.page.ts:35`):
the advisory cycle never produces a pending decision, so the dashboard stays in
`dashboard.advisory.generatingTitle` with `pendingDecisions: 0`. This blocks `nestfolio-e2e`
from being green (e2e-gaps-queued ⇒ queued).

## Evidence (2026-06-15, deployed dev)

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
