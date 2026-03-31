# ledger-adpt

Domain: ledger | Bus: LedgerBus
Stack: services/ledger/ledger-adpt/src/service.stack.ts

## State
None (stateless adapter)

## Cross-Domain Ingestion Rules (Pull Model)
- ExecutionBus → LedgerBus:
  ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED, ALPACA_ACCOUNT_SNAPSHOT

## DLQs
- FromExecutionDLQ (14-day retention, KMS encrypted)

## Event Types (domain/events.ts)
- LedgerCrossDomainEventTypes: events published by ledger domain (used by same-domain services)
- LedgerIngestEventTypes: events consumed from external domain buses

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
