# ledger-ctrl

Domain: ledger | Bus: LedgerBus
Stack: services/ledger/ledger-ctrl/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- LedgerBus → ledger-ctrl-ingress (SQS → Lambda)
  Subscriptions: ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, CORPORATE_ACTION_APPLIED, DECISION_PACKET_CREATED

## Egress
- CDC: DynamoDB Streams → ledger-ctrl-egress (Lambda)
  Emits:
    - BalanceEvent: insert → BALANCE_UPDATED, modify → BALANCE_EVENT_UPDATED
    - PortfolioEvent: insert → PORTFOLIO_UPDATED, modify → PORTFOLIO_EVENT_UPDATED
    - LedgerEntryEvent: insert → LEDGER_ENTRY_RECORDED, modify → LEDGER_ENTRY_EVENT_UPDATED

## Standalone Lambdas
- ReducerFn: DynamoDB Streams consumer that materializes account snapshots (not via Ingress)
  - Filters: INSERT events where __typename = LedgerEntry
  - Batch size 100, 5s batching window, bisect on error, 3 retries
  - Reads/writes State table

## Handlers
- event-listener.ts — ingestion handler; routes actual events (ORDER_FILLED, etc.) to ledger entries and tax lot tracking; routes simulation events (DECISION_PACKET_CREATED) to shadow fill
- event-publisher.ts — CDC changeDataCapture() pipeline
- reducer.ts — replayAndReduce pipeline; groups LedgerEntry items by tenantId+streamType, applies accountReducer, writes snapshots (daily + latest)

## Event Types (domain/events.ts)
- LedgerCtrlEventTypes: BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, LEDGER_PROCESSING_FAILED, LEDGER_SIMULATION_FAILED

## Tests
- service.stack.test.ts
- tax-lot-manager.test.ts
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

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/extensions, cdk-constructs/utils, event-processor, event-processor/sourcing
- cross-domain: @nestfolio/execution-adpt/domain, @nestfolio/advisory-adpt/domain
