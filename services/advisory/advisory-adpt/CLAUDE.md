# advisory-adpt

Domain: advisory | Bus: AdvisoryBus
Stack: services/advisory/advisory-adpt/src/service.stack.ts

## State
None (stateless adapter)

## Cross-Domain Ingestion Rules (Pull Model)
- InvestorBus → AdvisoryBus:
  GOAL_UPDATED, RISK_PROFILE_UPDATED, OPERATING_MODE_CHANGED, MANDATE_GRANTED, MANDATE_UPDATED, MANDATE_REVOKED
- ExecutionBus → AdvisoryBus:
  ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, PORTFOLIO_DRIFT_DETECTED, BROKER_SESSION_LOST, STREAM_DISCONNECTED, RECONCILIATION_FAILED
- LedgerBus → AdvisoryBus:
  PORTFOLIO_UPDATED, PORTFOLIO_DRIFT_DETECTED, RECONCILIATION_FAILED

## DLQs
- FromInvestorDLQ, FromExecutionDLQ, FromLedgerDLQ (14-day retention, KMS encrypted)

## Event Types (domain/events.ts)
- AdvisoryCrossDomainEventTypes: events published by advisory domain (used by same-domain services)
- AdvisoryIngestEventTypes: events consumed from external domain buses

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
