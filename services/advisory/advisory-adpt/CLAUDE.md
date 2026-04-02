# advisory-adpt

Domain: advisory | Bus: advisoryBus
Stack: services/advisory/advisory-adpt/src/service.stack.ts

## State
None (stateless adapter — EB Rule forwarding only)

## Cross-Domain Event Forwarding (Pull Model)
- Investor → Advisory:
  Rule on investorBus → advisoryBus (DLQ: FromInvestorDLQ, 14-day retention, KMS encrypted)
  Events: GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, MANDATE_CREATED, MANDATE_UPDATED

- Execution → Advisory:
  Rule on executionBus → advisoryBus (DLQ: FromExecutionDLQ, 14-day retention, KMS encrypted)
  Events: ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED

- Ledger → Advisory:
  Rule on ledgerBus → advisoryBus (DLQ: FromLedgerDLQ, 14-day retention, KMS encrypted)
  Events: PORTFOLIO_UPDATED, PORTFOLIO_DRIFT_DETECTED

## Event Types (domain/events.ts)
- AdvisoryCrossDomainEventTypes: DECISION_PACKET_CREATED, DECISION_APPROVED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, USER_CONFIRMATION_REQUESTED, EXPLANATION_GENERATED, DECISION_BLOCKED, ESCALATION_TRIGGERED, INCIDENT_DETECTED, INCIDENT_RESOLVED, USER_CONFIRMED
- AdvisoryIngestEventTypes: GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, MANDATE_CREATED, MANDATE_UPDATED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, PORTFOLIO_UPDATED, PORTFOLIO_DRIFT_DETECTED

## Tests
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs (core, observability, extensions)
