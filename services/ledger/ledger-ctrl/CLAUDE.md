# ledger-ctrl

Domain: ledger | Bus: LedgerBus
Stack: services/ledger/ledger-ctrl/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- LedgerBus → ledger-ctrl-ingress (SQS → Lambda)
  Subscriptions: ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, CORPORATE_ACTION_PROCESSED, DECISION_PACKET_CREATED

## Egress
- CDC: DynamoDB Streams → ledger-ctrl-egress (Lambda)
  Emits: BalanceEvent, PortfolioEvent, LedgerEntryEvent

## Reducer
- ReducerFn: DynamoDB Streams consumer that materializes account snapshots
  - Filters: INSERT events where __typename = LedgerEntry
  - Batch size 100, 5s batching window, bisect on error, 3 retries

## Handlers
- event-listener.ts
- event-publisher.ts
- reducer.ts

## Event Types (domain/events.ts)
- LedgerCtrlEventTypes: BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, LEDGER_PROCESSING_FAILED, LEDGER_SIMULATION_FAILED

## Tests
- service.stack.test.ts
- repositories/ledger.repository.test.ts
- tax-lot-manager.test.ts
- domain/cancel-order.test.ts
- domain/account.reducer.test.ts
- domain/record-deposit.test.ts
- domain/record-fill.test.ts
- domain/submit-order.test.ts
- domain/account-state.test.ts
- domain/record-corporate-action.test.ts
- domain/record-withdrawal.test.ts
- handlers/reducer.test.ts
- handlers/event-listener.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/extensions, cdk-constructs/utils
