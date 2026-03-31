# investor-adpt

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-adpt/src/service.stack.ts

## State
None (stateless adapter)

## Cross-Domain Ingestion Rules (Pull Model)
- AdvisoryBus → InvestorBus:
  DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, EXPLANATION_GENERATED, DECISION_APPROVED, DECISION_BLOCKED, ESCALATION_TRIGGERED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, INCIDENT_DETECTED, INCIDENT_RESOLVED
- ExecutionBus → InvestorBus:
  ORDER_STAGED, ORDER_REJECTED, ORDER_CANCELLED, WITHDRAWAL_REJECTED, WITHDRAWAL_COMPLETED, ORDER_ESCALATED, BROKER_CIRCUIT_OPEN
- LedgerBus → InvestorBus:
  BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, LEDGER_PROCESSING_FAILED

## DLQs
- FromAdvisoryDLQ, FromExecutionDLQ, FromLedgerDLQ (14-day retention, KMS encrypted)

## Event Types (domain/events.ts)
- InvestorCrossDomainEventTypes: events published by investor domain (used by same-domain services)
- InvestorIngestEventTypes: events consumed from external domain buses

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
