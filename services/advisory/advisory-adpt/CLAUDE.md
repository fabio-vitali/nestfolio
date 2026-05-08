# advisory-adpt

Domain: advisory | Bus: AdvisoryBus
Stack: `services/advisory/advisory-adpt/src/service.stack.ts`
Tags: `scope:advisory`, `type:adpt`

## State

None (stateless adapter -- EB Rule forwarding only)

## Ingress (Cross-Domain Event Forwarding, Pull Model)

### Investor -> Advisory
Rule on InvestorBus -> AdvisoryBus (DLQ: FromInvestorDLQ, 14-day retention, KMS encrypted)
Events (4, post-collapse): INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED, MANDATE_REVOKED

Down from 7 (legacy: GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, MANDATE_CREATED, MANDATE_UPDATED). The composite InvestorProfile row + MandateStatus row collapsed the per-entity events; downstream advisory consumers (decision-workflow-ctrl, compliance-ctrl) re-subscribed accordingly.

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
- `test/integration/from-investor.integration.test.ts` -- INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED, MANDATE_REVOKED forwarding
- `test/integration/from-execution.integration.test.ts` -- execution event forwarding
- `test/integration/from-ledger.integration.test.ts` -- ledger event forwarding

## Dependencies

- `@nestfolio/cdk-constructs` (core, observability, extensions)
- `@nestfolio/event-types` (eventName branded type)
- `@nestfolio/test-support` (integration tests)
- `@nestfolio/integration-testing` (EventBusTrap)
