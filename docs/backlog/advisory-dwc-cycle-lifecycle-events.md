---
id: advisory-dwc-cycle-lifecycle-events
status: shipped
rank: 1
type: feature
notes: "WS-1 of advisory-generating-failed-ux: decision-workflow-ctrl emits DECISION_CYCLE_STARTED (SF-start putEvents, decisionId, __version:0) + DECISION_CYCLE_FAILED (SF Catch on agent/assemble steps, __version:1); extends WorkflowStatus with GENERATING|FAILED; publishes both on advisoryBus."
references:
  - docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md
  - services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - services/advisory/decision-workflow-ctrl/src/domain/models.ts
  - services/advisory/decision-workflow-ctrl/src/domain/events.ts
out_of_scope:
  - advisory-bff projection of GENERATING/FAILED onto DecisionReadModel (WS-2)
  - advisory-mfe UI rendering + staleness guard + e2e rewrite (WS-3)
  - dashboard generating/failed reflection + dashboard e2e retarget (WS-4)
  - post-packet failure surfacing (BLOCKED/REJECTED are existing decision statuses)
  - changing the DecisionPacket CDC __version emission (WS-1 only VERIFIES it already seeds __version:1 on insert; no producer change here)
  - uncatchable States.Runtime failures emitting FAILED (covered by WS-3 UI staleness guard; documented limitation only)
spec: docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md
plan: docs/superpowers/plans/2026-06-04-advisory-dwc-cycle-lifecycle-events.md
topic_memory: []
validation_gate: |
  Shipped 2026-06-04 on branch worktree-advisory-dwc-cycle-lifecycle-events (commits de98de5a..86caafe9, 6 commits).
  - Code: models.ts WorkflowStatus += GENERATING|FAILED; events.ts += DECISION_CYCLE_STARTED/FAILED; decision-state-machine.ts
    EmitDecisionCycleStarted (fire-and-forget putEvents, GENERATING __version:0, spliced after UnpackTriggerEnvelope) +
    shared Catch (States.ALL, resultPath $.error) on ParallelProjections/InvokePortfolioEngine/InvokeAdvisoryNarrative/
    AssembleDecisionPacket → EmitDecisionCycleFailed (FAILED __version:1) → Fail. No service.stack.ts change (existing
    grantPutEventsTo covers it; SF-direct, not CDC). Each task spec+quality reviewed via subagent-driven-development.
  - Unit: nx run decision-workflow-ctrl:test 144/144 (10 suites) incl. 4 new WS-1 SF assertions; typecheck + lint green.
  - nx affected -t test,lint --base=origin/main: 28 projects green (widened ./events export breaks no consumer).
  - Deploy: dev-decision-workflow-ctrl UPDATE_COMPLETE, StateMachine updated (deploy.sh, 72.5s; /tmp/dwc-ws1-deploy.log).
  - Synthetic SF STARTED proof (exec ws1-validate-86caafe9): EmitDecisionCycleStarted TaskSucceeded → DECISION_CYCLE_STARTED
    published; happy path then ran PE→AN→AssembleDecisionPacket→WaitForCompliance all succeeding (chain intact post-change).
  - Synthetic SF FAILED proof (exec ws1-failed-proof-1780591797): send-task-failure on the InvokePortfolioEngine token →
    TaskFailed → Catch fired → EmitDecisionCycleFailed TaskSucceeded (subject {status:FAILED, __version:1, decisionId,
    tenantId:e2e-ws1-failed} — resultPath $.error preserved the ids) → DecisionCycleFailed Fail → ExecutionFailed. Proves the
    Catch fires on a catchable pre-packet failure (not just unit-wired; per feedback_states_runtime_uncatchable).
  - Integration (deployed dev): nx run decision-workflow-ctrl:test-integration 3 suites / 20 tests PASS incl. resilience, no flakes.
  Out of scope (WS-2/3/4) untouched; events are emitted-but-unconsumed until WS-2 subscribes (independently deployable).
---

# WS-1 — decision-workflow-ctrl cycle-lifecycle events

Part of the `advisory-generating-failed-ux` mini-program (design umbrella:
`docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md`, §3).
First piece — independently deployable (the new events are ignored until WS-2
consumes them).

Scope:
- `domain/models.ts`: `WorkflowStatus += 'GENERATING' | 'FAILED'`.
- `domain/events.ts`: add `DECISION_CYCLE_STARTED`, `DECISION_CYCLE_FAILED`.
- `constructs/decision-state-machine.ts`:
  - fire-and-forget `CustomState` putEvents emitting `DECISION_CYCLE_STARTED`
    right after `UnpackTriggerEnvelope` (carries `$.decisionId`, `tenantId`,
    `status: 'GENERATING'`, `__version: 0`; standard envelope; SF putEvents source
    convention).
  - SF `Catch` on `ParallelProjections` / `InvokePortfolioEngine` /
    `InvokeAdvisoryNarrative` / `AssembleDecisionPacket` → putEvents emitting
    `DECISION_CYCLE_FAILED` (`status: 'FAILED'`, `__version: 1`) → terminate.
    Pre-packet scope only; uncatchable `States.Runtime` is handled by WS-3's UI
    staleness guard (documented limitation).
- Publish both events on advisoryBus the way DWC's existing SF events are wired
  (Ingress/Egress); register event names.
- Unit/synth tests; deploy decision-workflow-ctrl; validate the events emit
  (synthetic SF run / CloudWatch).

Verify during execution: the DecisionPacket CDC emits `__version: 1` on insert
(so STARTED's v0 sorts below it), and the SF source/envelope matches what
advisory-bff's Ingress `$or` accepts.
