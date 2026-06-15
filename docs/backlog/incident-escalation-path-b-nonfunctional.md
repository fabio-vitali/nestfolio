---
id: incident-escalation-path-b-nonfunctional
status: shipped
type: bug
notes: "incident-escalation Path B is dead: ESCALATION_TRIGGERED / INCIDENT_DETECTED / INCIDENT_RESOLVED are declared-but-unemitted constants (no producer, no CDC, no PutEvents); compliance-ctrl never escalates and investor-ctrl subscribes to neither escalation event, so investors are never notified of compliance OR order escalations. DECISION (2026-06-15): remove the dead constants (L1→L2 escalation is already realized via compliance-ctrl authority-resolver + decision-workflow taskToken; incident containment via circuit-breaker/reconciliation/order-escalation — investigation confirmed nothing functional is lost) AND wire the real Path C convergence gap (investor-ctrl subscribes to ORDER_ESCALATED → notification). Also removes the co-dead USER_CONFIRMATION_REQUESTED (no producer since Task-1.5 taskToken redesign) + its unreachable dashboard-bff handler. Then refresh incident-escalation.flow.yaml + architecture docs + C4. Surfaced 2026-06-14 by the flows-vs-code audit."
references: []
out_of_scope:
  - "Building a real compliance-escalation producer or a generic incident-response (SEV-1..5) lifecycle — the L1→L2 goal is already realized via the authority-resolver + taskToken design; rejected as superseded."
  - "The order-execution SF input-contract gap (parked: broker-ctrl-order-sf-input-contract-gap) — whether ORDER_ESCALATED actually fires in prod is a separate concern; the investor notification is wired regardless."
  - "Whether dashboard-bff recent-activity should source an 'awaiting confirmation' item from the DecisionPacket AWAITING_CONFIRMATION CDC path (the intent of the dead USER_CONFIRMATION_REQUESTED handler) — filed as a separate parking finding."
  - "adapter-event-name redeclare-vs-reexport hardening (parked) — this slice follows the existing eventName() redeclare convention."
spec: docs/superpowers/specs/2026-06-15-incident-escalation-path-b-design.md
plan: docs/superpowers/plans/2026-06-15-incident-escalation-path-b.md
topic_memory: []
validation_gate: |
  Shipped 2026-06-16 (branch worktree-incident-escalation-path-b, 11 commits 9c8ffeb0..HEAD).
  - Unit/lint: `nx run-many -t test,lint` GREEN on the 22 true-affected projects
    (tools/affected-projects.mjs), incl. investor-ctrl ORDER_ESCALATED→Notification
    regression (69/69) + dashboard-bff handler-count 13→12 (60/60).
  - validate-flow incident-escalation: GREEN — broker-ctrl emits ORDER_ESCALATED
    (service.stack.ts:26) → investor-adpt FromExecution (service.stack.ts:74) →
    investor-ctrl TriggerIngress (service.stack.ts:31) + handler (event-listener.ts:232)
    → record('Notification') → NOTIFICATION_CREATED.
  - service-card-drift gate: OK (0 drift) across the 5 touched cards.
  - Deploy (dev sandbox 771924376645): `deploy.sh sandbox --prefix=dev
    --services=investor-ctrl,investor-adpt,dashboard-bff` → ✅ dev-investor-ctrl,
    ✅ dev-investor-adpt, ✅ dev-dashboard-bff (UPDATE_COMPLETE; TriggerIngress Rule+Handler,
    InvestorIngress-FromAdvisory, Ingress Rule+Handler all updated).
  - Live confirmation: deployed investor-ctrl EB rule (dev-investor-event-bus) now carries
    16 detail-types incl. ORDER_ESCALATED; ESCALATION_TRIGGERED absent.
  - No e2e: the ORDER_ESCALATED path is a 300s broker-SF timeout, not e2e-triggerable.
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

## Decision (2026-06-15): remove dead Path B + wire real Path C

Investigation (see spec) established the original intent and that **nothing functional is lost** by
removal:

- `ESCALATION_TRIGGERED` was the spec's **L1→L2 authority escalation** — already realized by
  `compliance-ctrl/src/rules/authority-resolver.ts` (computes `authorityLevel`) +
  decision-workflow SF `ComplianceChoice` routing L2 → `RequestUserConfirmation` (taskToken on the
  DecisionPacket). Not an event; superseded.
- `INCIDENT_DETECTED`/`INCIDENT_RESOLVED` were the governance **Incident Response** (SEV-1..5)
  lifecycle — never built; containment is realized domain-specifically (circuit breaker,
  reconciliation drift, order escalation). The generic lifecycle is not represented by these
  constants anyway.
- `USER_CONFIRMATION_REQUESTED` is co-dead (no producer since the Task-1.5 taskToken redesign) yet
  still forwarded by `investor-adpt` FromAdvisory and handled by an unreachable `dashboard-bff`
  branch.

## Done

1. **Wire Path C** — `investor-ctrl` subscribes to `ORDER_ESCALATED` → `buildNotificationRecord(…,
   'ORDER', subject.orderId)` (mirrors the existing `ORDER_REJECTED` handler) + a new
   `NOTIFICATION_TEMPLATES` entry. Event already flows broker-ctrl → ExecutionBus → investor-adpt
   FromExecution → InvestorBus (no producer/adapter change).
2. **Remove dead constants** — delete `ESCALATION_TRIGGERED` / `INCIDENT_DETECTED` /
   `INCIDENT_RESOLVED` / `USER_CONFIRMATION_REQUESTED` declarations from
   `compliance-ctrl` / `advisory-adpt` / `investor-adpt` `events.ts`; delete the 4 orphan
   `investor-adpt` FromAdvisory rule entries; delete the dead `dashboard-bff`
   `USER_CONFIRMATION_REQUESTED` subscription + `recentActivity` handler.
3. **Tests** — investor-ctrl ORDER_ESCALATED → Notification regression test; dashboard-bff handler
   assertion drop + count 13→12.
4. **Docs** — refresh `flows/incident-escalation.flow.yaml` (Path B removed/reframed; Path C
   functional), regenerate `docs/data-flows/incident-escalation.md` + `validate-flow`; update
   `docs/architecture/SYSTEM-ARCHITECTURE.md` + `SERVICE-INVENTORY.md`; regenerate C4 diagrams.
5. **Deploy** — `investor-ctrl`, `investor-adpt`, `dashboard-bff` (EB-rule/handler changes).
