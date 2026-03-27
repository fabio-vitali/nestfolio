# broker-alpaca-adpt

Domain: execution | Bus: ExecutionBus
Stack: services/execution/broker-alpaca-adpt/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- ExecutionBus → broker-alpaca-adpt-ingress (SQS → Lambda)
  Subscriptions: ALPACA_ORDER_REQUESTED, ALPACA_ORDER_CANCEL_REQUESTED, ALPACA_TRANSFER_REQUESTED, ALPACA_ACCOUNT_CHECK

## Egress
- CDC: DynamoDB Streams → broker-alpaca-adpt-egress (Lambda)
  Emits: AlpacaOrderResult, AlpacaTransferResult, AlpacaAccountSnapshot

## Handlers
- event-listener.ts
- event-publisher.ts
- trade-event-poller.ts
- transfer-status-poller.ts

## Event Types (domain/events.ts)
- AlpacaAdptEventTypes (inbound): ALPACA_ORDER_REQUESTED, ALPACA_ORDER_CANCEL_REQUESTED, ALPACA_TRANSFER_REQUESTED, ALPACA_ACCOUNT_CHECK
- AlpacaAdptEventTypes (outbound/CDC): ALPACA_ORDER_PLACED, ALPACA_ORDER_FILLED, ALPACA_ORDER_PARTIALLY_FILLED, ALPACA_ORDER_REJECTED, ALPACA_ORDER_CANCELLED, ALPACA_ORDER_CANCEL_FAILED, ALPACA_TRANSFER_INITIATED, ALPACA_TRANSFER_COMPLETED, ALPACA_TRANSFER_FAILED, ALPACA_ACCOUNT_SNAPSHOT

## Tests
- alpaca-orders.service.test.ts
- alpaca.client.test.ts
- event-listener.test.ts
- event-publisher.test.ts
- order-mapping.repository.test.ts
- polling-state.repository.test.ts
- trade-event-poller.test.ts
- transfer-mapping.repository.test.ts
- transfer-status-poller.test.ts

## Dependencies
- libs: cdk-constructs/core
