# ledger-adpt

Domain: ledger | Bus: ledgerBus
Stack: services/ledger/ledger-adpt/src/service.stack.ts

## State
None (stateless adapter — EB Rule forwarding only)

## Cross-Domain Event Forwarding (Pull Model)
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- LedgerIngress-FromAdvisory: DECISION_PACKET_CREATED
- LedgerIngress-FromExecution: ALPACA_ACCOUNT_SNAPSHOT, CORPORATE_ACTION_APPLIED, DEPOSIT_SETTLED, ORDER_CANCELLED, ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, PORTFOLIO_SNAPSHOT_IMPORTED, WITHDRAWAL_SETTLED
<!-- /card-drift:ingress -->
- Execution → Ledger:
  Rule on executionBus → ledgerBus (DLQ: FromExecutionDLQ, 14-day retention, KMS encrypted)

- Advisory → Ledger:
  Rule on advisoryBus → ledgerBus (DLQ: FromAdvisoryDLQ, 14-day retention, KMS encrypted)

## Event Types (domain/events.ts)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- LedgerCrossDomainEventTypes: BALANCE_UPDATED, LEDGER_ENTRY_RECORDED, LEDGER_PROCESSING_FAILED, PORTFOLIO_DRIFT_DETECTED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED
- LedgerIngestEventTypes: ALPACA_ACCOUNT_SNAPSHOT, CORPORATE_ACTION_APPLIED, DECISION_PACKET_CREATED, DEPOSIT_SETTLED, ORDER_CANCELLED, ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, PORTFOLIO_SNAPSHOT_IMPORTED, WITHDRAWAL_SETTLED
<!-- /card-drift:event-types -->

## Tests
- service.stack.test.ts

Domain adapters are pure EB rule forwarders (no handlers, no DDB). Per-adapter integration tests were removed 2026-05-13 — coverage is the CDK snapshot test + e2e flows that cross the forwarding hop via downstream consumers.

## Dependencies
- libs: cdk-constructs (core, observability, extensions)
