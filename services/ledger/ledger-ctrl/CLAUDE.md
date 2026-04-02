# ledger-ctrl

Domain: ledger | Bus: ledgerBus
Stack: services/ledger/ledger-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- ledgerBus → ledger-ctrl-ingress (SQS → Lambda)
  Subscriptions: ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, CORPORATE_ACTION_APPLIED, DECISION_PACKET_CREATED

## Egress
- CDC: DynamoDB Streams → ledger-ctrl-egress (Lambda)
  Emits:
  - BalanceEvent → insert: BALANCE_UPDATED, modify: BALANCE_EVENT_UPDATED
  - PortfolioEvent → insert: PORTFOLIO_UPDATED, modify: PORTFOLIO_EVENT_UPDATED
  - LedgerEntryEvent → insert: LEDGER_ENTRY_RECORDED, modify: LEDGER_ENTRY_EVENT_UPDATED

## Standalone Lambdas
- ReducerFn: DDB Stream consumer that materializes account snapshots
  Filter: INSERT events where __typename = 'LedgerEntry'
  Batch: 100 records, 5s window, bisect on error, 3 retries

## Handlers
- event-listener.ts — Ingress event handler
- event-publisher.ts — Egress CDC publisher
- reducer.ts — Account snapshot materializer (DDB Stream consumer)

## Event Types (domain/events.ts)
- LedgerCtrlEventTypes: BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, LEDGER_PROCESSING_FAILED, LEDGER_SIMULATION_FAILED

## Tests
- domain/account-state.test.ts
- domain/account.reducer.test.ts
- domain/cancel-order.test.ts
- domain/record-corporate-action.test.ts
- domain/record-deposit.test.ts
- domain/record-fill.test.ts
- domain/record-withdrawal.test.ts
- domain/submit-order.test.ts
- handlers/event-listener.test.ts
- handlers/reducer.test.ts
- repositories/ledger.repository.test.ts
- service.stack.test.ts
- tax-lot-manager.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor
