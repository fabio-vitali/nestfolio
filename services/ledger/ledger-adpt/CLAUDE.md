# ledger-adpt

Domain: ledger | Bus: LedgerBus
Stack: services/ledger/ledger-adpt/src/service.stack.ts

## State
None (stateless adapter)

## Cross-Domain Forwarding Rules
- LedgerBus → InvestorBus:
  BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, LEDGER_PROCESSING_FAILED
- LedgerBus → AdvisoryBus:
  PORTFOLIO_UPDATED, PORTFOLIO_DRIFT_DETECTED, RECONCILIATION_FAILED

## DLQs
- ToInvestorDLQ, ToAdvisoryDLQ (14-day retention, KMS encrypted)

## Event Types (domain/events.ts)
- LedgerCrossDomainEventTypes: BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, LEDGER_PROCESSING_FAILED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, PORTFOLIO_DRIFT_DETECTED

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
