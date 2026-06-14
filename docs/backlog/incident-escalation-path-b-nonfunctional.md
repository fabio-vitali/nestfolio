---
id: incident-escalation-path-b-nonfunctional
status: queued
type: bug
rank: 3
notes: "incident-escalation Path B is dead: ESCALATION_TRIGGERED / INCIDENT_DETECTED / INCIDENT_RESOLVED are declared-but-unemitted constants (no producer, no CDC, no PutEvents); compliance-ctrl never escalates and investor-ctrl subscribes to neither escalation event, so investors are never notified of compliance OR order escalations. Decide implement-vs-remove; then refresh incident-escalation.flow.yaml. Surfaced 2026-06-14 by the flows-vs-code audit."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Incident-escalation Path B is a dead event path

## Evidence

- `services/advisory/compliance-ctrl/src/handlers/event-listener.ts` only ever returns
  `record('ComplianceCheck')` / `record('AuditArtifact')` / `projectVersioned('MandateSnapshot')` —
  no escalation branch.
- `src/handlers/event-publisher.ts:4` is a pure `changeDataCapture` CDC publisher (no direct
  PutEvents); `src/service.stack.ts:26-32` Egress maps only `ComplianceCheck.result →
  DECISION_APPROVED/DECISION_BLOCKED`.
- `ESCALATION_TRIGGERED` (`compliance-ctrl/src/domain/events.ts:7`) +
  `INCIDENT_DETECTED`/`INCIDENT_RESOLVED` (`advisory-adpt/src/domain/events.ts:16-17`) are dead
  constants — no producer anywhere. `investor-adpt`'s `InvestorIngress-FromAdvisory` rule still lists
  `ESCALATION_TRIGGERED` (an orphan rule entry forwarding an event nobody emits).
- `investor-ctrl` subscribes to neither `ESCALATION_TRIGGERED` nor `ORDER_ESCALATED`
  (`src/service.stack.ts:15-30`), so even Path C (broker order escalation, which DOES emit
  `ORDER_ESCALATED` from broker-ctrl) produces no investor notification — the convergence gap.

## Done (a design decision is required first)

- EITHER implement escalation: emit a real escalation event on compliance threshold breach + have
  `investor-ctrl` subscribe (`ESCALATION_TRIGGERED` and/or `ORDER_ESCALATED`) → notification; prune
  the orphan adapter rule entries for any events not kept.
- OR (per the no-deprecation stance) stop-emitting/remove the dead
  `ESCALATION_TRIGGERED`/`INCIDENT_DETECTED`/`INCIDENT_RESOLVED` constants + the orphan
  `investor-adpt` rule entry, and reduce the flow to the real Path C convergence gap.
- Then refresh `flows/incident-escalation.flow.yaml` (it currently annotates Path B as
  `[UNIMPLEMENTED]`), regenerate `docs/data-flows/`, and re-run `validate-flow incident-escalation`.
