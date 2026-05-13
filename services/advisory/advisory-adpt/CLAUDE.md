# advisory-adpt

Domain: advisory | Bus: AdvisoryBus
Stack: `services/advisory/advisory-adpt/src/service.stack.ts`
Tags: `scope:advisory`, `type:adpt`

## State

None (stateless adapter -- EB Rule forwarding only)

## Ingress (Cross-Domain Event Forwarding, Pull Model)

### Investor -> Advisory
Rule on InvestorBus -> AdvisoryBus (DLQ: FromInvestorDLQ, 14-day retention, KMS encrypted)
Events (4): INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED, MANDATE_REVOKED, OPERATING_MODE_CHANGED

The carrier (INVESTOR_PROFILE_UPDATED) is forwarded for decision-workflow-ctrl re-decision triggers. MANDATE_ISSUED + OPERATING_MODE_CHANGED feed decision-workflow-ctrl's MandateProjectorIngress (operating-mode-lookup, 2026-05-10). MANDATE_REVOKED + OPERATING_MODE_CHANGED feed compliance-ctrl. INVESTOR_PROFILE_CREATED was dropped 2026-05-10 — zero advisoryBus consumers post-migration to MANDATE_SNAPSHOT_CREATED-driven first decision.

### Execution -> Advisory
Rule on ExecutionBus -> AdvisoryBus (DLQ: FromExecutionDLQ, 14-day retention, KMS encrypted)
Events: ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED

### Ledger -> Advisory
Rule on LedgerBus -> AdvisoryBus (DLQ: FromLedgerDLQ, 14-day retention, KMS encrypted)
Events: PORTFOLIO_UPDATED, PORTFOLIO_DRIFT_DETECTED

## Egress

None (adapter does not emit events)

## Standalone Lambdas

None (no handlers -- pure EB rule forwarding)

## Facade

None

## Orchestration

None

## Event Types (domain/events.ts)

### AdvisoryCrossDomainEventTypes (exported, not used by this stack)
DECISION_PACKET_CREATED, DECISION_APPROVED, USER_CONFIRMATION_REQUESTED, EXPLANATION_GENERATED, DECISION_BLOCKED, ESCALATION_TRIGGERED, INCIDENT_DETECTED, INCIDENT_RESOLVED, USER_CONFIRMED

### AdvisoryIngestEventTypes (used in EB rules)
INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED, MANDATE_REVOKED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, PORTFOLIO_UPDATED, PORTFOLIO_DRIFT_DETECTED

## Tests

- `test/service.stack.test.ts` -- CDK snapshot assertions (3 rules, 3 DLQs, tags)

Domain adapters are pure EB rule forwarders (no handlers, no DDB). The CDK snapshot test verifies rule shape; e2e feature tests exercise the forwarding hop end-to-end via downstream consumers. Per-adapter integration tests were removed 2026-05-13 — they hit an EventBridge rule-propagation race in `EventBusTrap` that was inherent to ephemeral test-time rules and could not be eliminated without bus-level architectural change.

## Dependencies

- `@nestfolio/cdk-constructs` (core, observability, extensions)
- `@nestfolio/event-types` (eventName branded type)
