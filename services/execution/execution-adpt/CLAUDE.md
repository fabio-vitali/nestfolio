# execution-adpt

Domain: execution | Bus: ExecutionBus
Stack: services/execution/execution-adpt/src/service.stack.ts

## State
None (stateless adapter)

## Cross-Domain Ingestion Rules (Pull Model)
- AdvisoryBus → ExecutionBus:
  DECISION_APPROVED, DECISION_PACKET_CREATED, USER_CONFIRMED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET
- InvestorBus → ExecutionBus:
  DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, EXECUTION_MODE_CHANGED

## DLQs
- FromAdvisoryDLQ, FromInvestorDLQ (14-day retention, KMS encrypted)

## Event Types (domain/events.ts)
- ExecutionCrossDomainEventTypes: events published by execution domain (used by same-domain services)
- ExecutionIngestEventTypes: events consumed from external domain buses

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
