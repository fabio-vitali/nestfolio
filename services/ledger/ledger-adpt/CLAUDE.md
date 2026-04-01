# ledger-adpt

Domain: ledger | Bus: LedgerBus
Stack: services/ledger/ledger-adpt/src/service.stack.ts

## State
None (stateless adapter)

## Cross-Domain Ingestion Rules (Pull Model)
- ExecutionBus → LedgerBus (EB Rule: LedgerIngress-FromExecution):
  ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED, ALPACA_ACCOUNT_SNAPSHOT
  - DLQ: FromExecutionDLQ (14-day retention, KMS encrypted)

## Event Types (domain/events.ts)
- LedgerCrossDomainEventTypes: BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, LEDGER_PROCESSING_FAILED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, PORTFOLIO_DRIFT_DETECTED
- LedgerIngestEventTypes: ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED, ALPACA_ACCOUNT_SNAPSHOT

## Tests
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
