# ledger-adpt

Domain: ledger | Bus: ledgerBus
Stack: services/ledger/ledger-adpt/src/service.stack.ts

## State
None (stateless adapter — EB Rule forwarding only)

## Cross-Domain Event Forwarding (Pull Model)
- Execution → Ledger:
  Rule on executionBus → ledgerBus (DLQ: FromExecutionDLQ, 14-day retention, KMS encrypted)
  Events: ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, TRANSFER_FAILED, CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED, ALPACA_ACCOUNT_SNAPSHOT

- Advisory → Ledger:
  Rule on advisoryBus → ledgerBus (DLQ: FromAdvisoryDLQ, 14-day retention, KMS encrypted)
  Events: DECISION_PACKET_CREATED

## Event Types (domain/events.ts)
- LedgerCrossDomainEventTypes: BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, LEDGER_PROCESSING_FAILED, RECONCILIATION_COMPLETED, PORTFOLIO_DRIFT_DETECTED
- LedgerIngestEventTypes: ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, TRANSFER_FAILED, CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED, ALPACA_ACCOUNT_SNAPSHOT, DECISION_PACKET_CREATED

## Tests
- service.stack.test.ts
- integration/ledger-adpt.integration.test.ts

## Dependencies
- libs: cdk-constructs (core, observability, extensions)
