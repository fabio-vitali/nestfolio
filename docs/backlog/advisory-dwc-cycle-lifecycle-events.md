---
id: advisory-dwc-cycle-lifecycle-events
status: queued
rank: 1
type: feature
notes: "WS-1 of advisory-generating-failed-ux: decision-workflow-ctrl emits DECISION_CYCLE_STARTED (SF-start putEvents, decisionId, __version:0) + DECISION_CYCLE_FAILED (SF Catch on agent/assemble steps, __version:1); extends WorkflowStatus with GENERATING|FAILED; publishes both on advisoryBus."
references:
  - docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md
  - services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - services/advisory/decision-workflow-ctrl/src/domain/models.ts
  - services/advisory/decision-workflow-ctrl/src/domain/events.ts
out_of_scope: []
spec: docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md
plan: null
topic_memory: []
validation_gate: null
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
