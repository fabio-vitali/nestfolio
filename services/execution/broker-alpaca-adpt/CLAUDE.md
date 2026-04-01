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
  Emits:
  - AlpacaOrderResult (insert): ALPACA_ORDER_PLACED, ALPACA_ORDER_FILLED, ALPACA_ORDER_PARTIALLY_FILLED, ALPACA_ORDER_REJECTED, ALPACA_ORDER_CANCELLED, ALPACA_ORDER_CANCEL_FAILED
  - AlpacaOrderResult (modify): ALPACA_ORDER_FILLED, ALPACA_ORDER_PARTIALLY_FILLED, ALPACA_ORDER_REJECTED, ALPACA_ORDER_CANCELLED
  - AlpacaTransferResult (insert): ALPACA_TRANSFER_INITIATED, ALPACA_TRANSFER_COMPLETED, ALPACA_TRANSFER_FAILED
  - AlpacaTransferResult (modify): ALPACA_TRANSFER_COMPLETED, ALPACA_TRANSFER_FAILED
  - AlpacaAccountSnapshot (insert): ALPACA_ACCOUNT_SNAPSHOT

## Orchestration
- OrderPollingStateMachine: polls Alpaca API for order status updates
  - Triggers: ALPACA_ORDER_PLACED
  - Timeout: 24 hours
  - Invokes: OrderPollFn on each poll cycle

- TransferPollingStateMachine: polls Alpaca API for transfer status updates
  - Triggers: ALPACA_TRANSFER_INITIATED
  - Timeout: 7 days
  - Invokes: TransferPollFn on each poll cycle

## Standalone Lambdas
- OrderPollFn: polls Alpaca order status (invoked by OrderPollingStateMachine, not via Ingress)
- TransferPollFn: polls Alpaca transfer status (invoked by TransferPollingStateMachine, not via Ingress)

## Handlers
- event-listener.ts — SQS Ingress handler (event-processor pipeline)
- event-publisher.ts — CDC Egress handler (event-processor pipeline)
- order-poll-handler.ts — polls Alpaca API for order status (standalone, SF-invoked)
- transfer-poll-handler.ts — polls Alpaca API for transfer status (standalone, SF-invoked)

## Constructs
- src/constructs/order-polling-definition.ts — SF state machine definition for order polling
- src/constructs/transfer-polling-definition.ts — SF state machine definition for transfer polling

## Event Types (domain/events.ts)
- AlpacaAdptEventTypes (inbound): ALPACA_ORDER_REQUESTED, ALPACA_ORDER_CANCEL_REQUESTED, ALPACA_TRANSFER_REQUESTED, ALPACA_ACCOUNT_CHECK
- AlpacaAdptEventTypes (outbound/CDC): ALPACA_ORDER_PLACED, ALPACA_ORDER_FILLED, ALPACA_ORDER_PARTIALLY_FILLED, ALPACA_ORDER_REJECTED, ALPACA_ORDER_CANCELLED, ALPACA_ORDER_CANCEL_FAILED, ALPACA_TRANSFER_INITIATED, ALPACA_TRANSFER_COMPLETED, ALPACA_TRANSFER_FAILED, ALPACA_ACCOUNT_SNAPSHOT

## Tests
- alpaca-orders.service.test.ts
- alpaca.client.test.ts
- event-listener.test.ts
- order-mapping.repository.test.ts
- order-poll-handler.test.ts
- transfer-mapping.repository.test.ts
- transfer-poll-handler.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/utils, event-processor
