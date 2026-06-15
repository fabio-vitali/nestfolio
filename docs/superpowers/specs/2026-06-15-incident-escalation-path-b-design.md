# Incident-escalation: remove dead Path B, wire real Path C

- **Backlog:** `incident-escalation-path-b-nonfunctional`
- **Date:** 2026-06-15
- **Type:** bug (dead-code removal + one functional wiring)
- **Lane:** Complex (cross-service, EB-rule changes, requires deploy)

## Problem

`flows/incident-escalation.flow.yaml` documents three escalation paths. The 2026-06-14 flows-vs-code
audit found Path B is a dead event path and Path C has a convergence gap:

- **Path B (compliance escalation):** `ESCALATION_TRIGGERED`, `INCIDENT_DETECTED`,
  `INCIDENT_RESOLVED` are declared-but-unemitted constants — zero producers, but the `investor-adpt`
  `InvestorIngress-FromAdvisory` rule still forwards all three.
- **Path C (order escalation):** `ORDER_ESCALATED` **is** emitted by broker-ctrl (CDC from the order
  Step Function timeout branch) and **is** forwarded to InvestorBus via `investor-adpt`
  `InvestorIngress-FromExecution` — but `investor-ctrl` subscribes to **neither** `ORDER_ESCALATED`
  nor `ESCALATION_TRIGGERED`, so an escalated order never produces an investor notification.

## Investigation — original intent and what removal costs

These constants existed since the **first commit** (`50063997`) as part of the original cross-domain
event vocabulary; the consumer forwarding was scaffolded speculatively but the producer side was
never built because the real implementations took a different shape.

| Constant | Original goal (per `specifications/`) | Realized today by | Lost on removal |
|---|---|---|---|
| `ESCALATION_TRIGGERED` | L1→L2 authority escalation (§Authority Levels; "Compliance Agent enforces L1-to-L2 escalation") | `compliance-ctrl/src/rules/authority-resolver.ts` computes `authorityLevel`; decision-workflow SF `ComplianceChoice` routes **L2 → RequestUserConfirmation** (taskToken written to the DecisionPacket, `status=AWAITING_CONFIRMATION`); resumed by `USER_CONFIRMED`. | **Nothing** — escalation is state + control-flow, not an event. |
| `INCIDENT_DETECTED` / `INCIDENT_RESOLVED` | Governance Incident Response lifecycle (SEV-1..5: execution pause, reconciliation lock, model rollback, global freeze) | Domain-specific containment: circuit breaker (`BROKER_CIRCUIT_OPEN/CLOSED`), reconciliation drift (`PORTFOLIO_DRIFT_DETECTED`), order escalation (`ORDER_ESCALATED`). | **Nothing** — the generic SEV lifecycle was never built and isn't represented by these constants. |
| `USER_CONFIRMATION_REQUESTED` (co-dead, found during mapping) | Request-confirmation event | Replaced in Task 1.5 by the taskToken-on-DecisionPacket design; no producer emits it. Still forwarded by `investor-adpt` FromAdvisory **and** handled by an unreachable `dashboard-bff` branch. | **Nothing** — the handler never fires. |

**Conclusion:** removing all four constants loses no functionality. Wiring Path C closes a real
convergence gap using the established system-event → notification pattern.

## Design

### Change 1 — Wire Path C (the functional fix)

Model exactly on the existing `ORDER_REJECTED` handler in `investor-ctrl`.

- `services/investor/investor-ctrl/src/service.stack.ts` — add `InvestorIngestEventTypes.ORDER_ESCALATED`
  to the `TriggerIngress` `eventTypes` array (expands the existing Ingress EB rule; no new construct).
- `services/investor/investor-ctrl/src/handlers/event-listener.ts`:
  - Add handler `[ExecutionCrossDomainEventTypes.ORDER_ESCALATED]: async (payload, ctx) => {
    const subject = parseSubject(payload, NormalizedOrderEventSchema);
    return buildNotificationRecord(ctx.tenantId, ctx, 'ORDER', subject.orderId); }`
    (`NormalizedOrderEventSchema` is already imported for `ORDER_REJECTED`; `subject.orderId` exists
    on the schema).
  - Add a `NOTIFICATION_TEMPLATES['ORDER_ESCALATED']` entry: title "Order Needs Review", body
    explaining the order could not complete and was escalated, channel `email,push`.

`ORDER_ESCALATED` is already declared in `investor-adpt` `InvestorIngestEventTypes` (events.ts:47),
`ExecutionCrossDomainEventTypes` (execution-adpt events.ts:12), and `BrokerCtrlEventTypes`
(broker-ctrl events.ts:9). `ORDER_ESCALATED` subject shape (broker-ctrl order SF timeout PutItem,
codified by `NormalizedOrderEventSchema`): `{ orderId, executionMode, failureReason?, timestamp,
filledQty?, averageFillPrice? }` plus the standard envelope `{ tenantId, userId, region }`.

### Change 2 — Remove dead constants + orphan forwarding

- Delete declarations:
  - `ESCALATION_TRIGGERED` — `compliance-ctrl/src/domain/events.ts:7`, `advisory-adpt/src/domain/events.ts:15`, `investor-adpt/src/domain/events.ts:31`
  - `INCIDENT_DETECTED` — `advisory-adpt/src/domain/events.ts:16`, `investor-adpt/src/domain/events.ts:32`
  - `INCIDENT_RESOLVED` — `advisory-adpt/src/domain/events.ts:17`, `investor-adpt/src/domain/events.ts:33`
  - `USER_CONFIRMATION_REQUESTED` — `advisory-adpt/src/domain/events.ts:12`, `investor-adpt/src/domain/events.ts:27`
- `services/investor/investor-adpt/src/service.stack.ts` — delete the four `fromAdvisoryEvents`
  entries (`USER_CONFIRMATION_REQUESTED`, `ESCALATION_TRIGGERED`, `INCIDENT_DETECTED`,
  `INCIDENT_RESOLVED` — lines 40/44/45/46).
- `services/investor/dashboard-bff/src/service.stack.ts` — delete the
  `InvestorIngestEventTypes.USER_CONFIRMATION_REQUESTED` Ingress entry (line 29).
- `services/investor/dashboard-bff/src/handlers/event-listener.ts` — delete the
  `[AdvisoryCrossDomainEventTypes.USER_CONFIRMATION_REQUESTED]: … recentActivity(…)` handler (line 33).

### Change 3 — Tests

- `services/investor/investor-ctrl/test/...` — add a regression test: `ORDER_ESCALATED` dispatches to
  a handler that produces a `Notification` row with `type='ORDER_ESCALATED'`, `relatedEntityType='ORDER'`,
  `relatedEntityId=subject.orderId` (mirror the existing `ORDER_REJECTED` test); assert the handler is
  registered in the map.
- `services/investor/dashboard-bff/test/unit/handlers/event-listener.test.ts` — remove the
  `USER_CONFIRMATION_REQUESTED` handler assertion (line 21) and decrement the handler-count
  expectation (line 8: 13 → 12).
- Confirm `advisory-bff/test/unit/service.stack.test.ts:64` and
  `decision-workflow-ctrl/test/unit/decision-state-machine.test.ts:452` (string-literal references in
  "removed/not-emitted" assertions) still compile and pass unchanged.

### Change 4 — Flow spec, architecture docs, C4

- `flows/incident-escalation.flow.yaml` — remove Path B (or reframe as: "L1→L2 escalation is realized
  via the authority-resolver + taskToken design, not an event; incident containment is
  domain-specific"); mark Path C as functional end-to-end through the new `investor-ctrl`
  notification. Regenerate `docs/data-flows/incident-escalation.md` and run
  `validate-flow incident-escalation`.
- `docs/architecture/SYSTEM-ARCHITECTURE.md` — update the event taxonomy / escalation narrative to
  drop the four dead events and reflect the order-escalation → notification path.
- `docs/architecture/SERVICE-INVENTORY.md` — update events published/consumed for `investor-ctrl`
  (+`ORDER_ESCALATED` consumed), `investor-adpt` (FromAdvisory forwarded set), `dashboard-bff`
  (−`USER_CONFIRMATION_REQUESTED`), `compliance-ctrl` / `advisory-adpt` (−dead declarations).
- Regenerate C4 diagrams via the `generate-c4-diagrams` skill (subscription changes alter the
  derivation); visually verify the SVGs.

### Deploy + validation

- **Deploy** (dev sandbox): `investor-ctrl` (new subscription + handler), `investor-adpt` (FromAdvisory
  rule shrinks), `dashboard-bff` (Ingress + handler shrink). Constant-only removals in
  `compliance-ctrl` / `advisory-adpt` don't change synthesized stacks (the constants were unused) —
  `detect-deploy-needed.mjs` confirms the deploy set.
- **Gate:** `nx run-many -t test,lint` on the true-affected set (`tools/affected-projects.mjs`); the
  `investor-ctrl` unit regression is the primary correctness gate. No full or Playwright e2e — the
  order-SF escalation path is not e2e-triggerable (a 300s adapter timeout), and no existing e2e
  drives it.

## Out of scope

- Building a real compliance-escalation producer or a generic incident-response (SEV-1..5) lifecycle —
  rejected as superseded by the authority-resolver + taskToken design.
- The order-execution SF input-contract gap (parked `broker-ctrl-order-sf-input-contract-gap`) —
  whether `ORDER_ESCALATED` fires in prod is separate; the notification is wired regardless.
- Whether `dashboard-bff` recent-activity should source an "awaiting confirmation" item from the
  DecisionPacket `AWAITING_CONFIRMATION` CDC path (the intent of the removed
  `USER_CONFIRMATION_REQUESTED` handler) — **file as a parking finding**; removing the dead handler
  may expose this latent feed gap.
- `adapter-event-name` redeclare-vs-reexport hardening (parked) — this slice follows the existing
  `eventName()` redeclare convention.

## Validation gate (filled at ship)

- Affected `nx test,lint` green (incl. investor-ctrl ORDER_ESCALATED regression + dashboard-bff
  count).
- Deploy log lines for investor-ctrl / investor-adpt / dashboard-bff.
- `validate-flow incident-escalation` clean; C4 SVGs regenerated + verified.
- Commit SHA(s).
