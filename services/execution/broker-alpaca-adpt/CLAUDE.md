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
  - NormalizedEvent (insert, passthrough): BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED

## Orchestration
- OrderPollingStateMachine: polls Alpaca API for order status updates
  - Triggers: ALPACA_ORDER_PLACED
  - Timeout: 24 hours
  - Invokes: OrderPollFn on each poll cycle

- TransferPollingStateMachine: polls Alpaca API for transfer status updates
  - Triggers: ALPACA_TRANSFER_INITIATED
  - Timeout: 7 days
  - Invokes: TransferPollFn on each poll cycle

- HealStateMachine: circuit breaker healing workflow (CircuitBreakerHealDefinition)
  - Triggers: BROKER_CIRCUIT_OPEN (via grantStartExecution, not EB rule — singleton guard)
  - executionName: 'heal-alpaca' (idempotent StartExecution)
  - Timeout: 2 hours
  - Health checks Alpaca API via EB Connection (HTTP:Invoke) with retry
  - On success: closes breaker (DDB UpdateItem) → emits BROKER_CIRCUIT_CLOSED (CDC)
  - On exhaustion: emits BROKER_HEAL_ESCALATED (CDC)

## Circuit Breaker
- Owner: broker-alpaca-adpt (global per-adapter key `CircuitBreaker#alpaca`)
- Repository: `src/repositories/circuit-breaker.repository.ts`
  - `isOpen(adapterId)` — DDB GetItem, checks state === 'OPEN'
  - `open(adapterId, reason)` — conditional PutItem (idempotent, returns false if already OPEN)
  - `close(adapterId)` — DDB UpdateItem
  - `writeBreakerOpenEvent(tenantId)` — writes NormalizedEvent for CDC passthrough
- Detection: event-listener checks `isOpen()` before every API call; on failure + health check down → opens breaker
- EB Connection: Alpaca API auth (APCA-API-KEY-ID + secret header from Secrets Manager)

## Standalone Lambdas
- OrderPollFn: polls Alpaca order status (invoked by OrderPollingStateMachine, not via Ingress)
- TransferPollFn: polls Alpaca transfer status (invoked by TransferPollingStateMachine, not via Ingress)

## Handlers
- event-listener.ts — SQS Ingress handler (event-processor pipeline); includes circuit breaker check + failure detection
- event-publisher.ts — CDC Egress handler (event-processor pipeline)
- order-poll-handler.ts — polls Alpaca API for order status (standalone, SF-invoked)
- transfer-poll-handler.ts — polls Alpaca API for transfer status (standalone, SF-invoked)

## Constructs
- src/constructs/order-polling-definition.ts — SF state machine definition for order polling
- src/constructs/transfer-polling-definition.ts — SF state machine definition for transfer polling

## Event Types (domain/events.ts)
- AlpacaAdptEventTypes (inbound): ALPACA_ORDER_REQUESTED, ALPACA_ORDER_CANCEL_REQUESTED, ALPACA_TRANSFER_REQUESTED, ALPACA_ACCOUNT_CHECK
- AlpacaAdptEventTypes (outbound/CDC): ALPACA_ORDER_PLACED, ALPACA_ORDER_FILLED, ALPACA_ORDER_PARTIALLY_FILLED, ALPACA_ORDER_REJECTED, ALPACA_ORDER_CANCELLED, ALPACA_ORDER_CANCEL_FAILED, ALPACA_TRANSFER_INITIATED, ALPACA_TRANSFER_COMPLETED, ALPACA_TRANSFER_FAILED, ALPACA_ACCOUNT_SNAPSHOT, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED

## Tests
- alpaca-orders.service.test.ts
- alpaca.client.test.ts
- circuit-breaker.repository.test.ts
- event-listener.test.ts
- order-mapping.repository.test.ts
- order-poll-handler.test.ts
- transfer-mapping.repository.test.ts
- transfer-poll-handler.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/utils, event-processor
