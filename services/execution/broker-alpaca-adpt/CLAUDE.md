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
  - Triggers: BROKER_CIRCUIT_OPEN (EB rule)
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

## Event Payload Contracts (domain/contracts.ts → @nestfolio/broker-alpaca-adpt/contracts)
Producer-owned zod CDC subject contracts, exported via `@nestfolio/broker-alpaca-adpt/contracts` (NOT re-exported through the `/domain` barrel). DRY domain subjects — identity travels in the event context (RequestContext), not on the subject.
- AlpacaOrderResultSchema / AlpacaOrderResult — ALPACA_ORDER_* subject (the `AlpacaOrderResult` row, sk='OrderMapping'|'CancelResult'). Fields: nestfolioOrderId, alpacaOrderId?, status (PLACED/FILLED/PARTIALLY_FILLED/REJECTED/CANCELLED/CANCEL_FAILED), symbol?, side?, requestedQty?, filledQuantity?, averageFillPrice?, rejectionReason?, timestamp?. (symbol/side/requestedQty present on PLACED/REJECTED, absent on CancelResult; timestamp optional — see backlog broker-alpaca-result-timestamp-drift.)
- AlpacaTransferResultSchema / AlpacaTransferResult — ALPACA_TRANSFER_* subject (the `AlpacaTransferResult` row, sk='TransferMapping'). Fields: nestfolioTransferId, alpacaTransferId, direction (INCOMING|OUTGOING), amount, status (INITIATED/COMPLETED/FAILED), failureReason?, timestamp?. (timestamp optional — see backlog broker-alpaca-result-timestamp-drift.)
- AlpacaAccountSnapshotSchema / AlpacaAccountSnapshot — ALPACA_ACCOUNT_SNAPSHOT subject (the `AlpacaAccountSnapshot` row, sk='Snapshot#${ts}'). Fields: equity (string|null), buyingPower (string|null), positions (array of {symbol, qty, marketValue}), status?, failureReason?. NOTE: equity/buyingPower are raw Alpaca API string values, NOT Number()-converted — tracked by backlog broker-alpaca-account-snapshot-equity-string-drift.
- BrokerCircuitEventSchema / BrokerCircuitEvent — BROKER_CIRCUIT_OPEN / BROKER_CIRCUIT_CLOSED / BROKER_HEAL_ESCALATED subject (the circuit-breaker `NormalizedEvent` row). Fields: adapter, timestamp.
- CircuitBreakerSchema / CircuitBreaker — internal global per-adapter state row (pk='CircuitBreaker#${adapter}', sk='CircuitBreaker'), NOT CDC-emitted, NO tenant identity. Fields: state (OPEN|CLOSED), adapter, openedAt, closedAt?, reason.
The Alpaca REST `*ApiResponse` interfaces (AlpacaOrderApiResponse, AlpacaTransferApiResponse, AlpacaAccountApiResponse) remain in domain/schemas.ts — they are external API response shapes, not producer contracts.

## Tests
- service.stack.test.ts
- unit/alpaca-orders.service.test.ts
- unit/alpaca.client.test.ts
- unit/circuit-breaker.repository.test.ts
- unit/event-listener.test.ts
- unit/order-mapping.repository.test.ts
- unit/order-poll-handler.test.ts
- unit/transfer-mapping.repository.test.ts
- unit/transfer-poll-handler.test.ts
- integration/broker-alpaca-adpt.integration.test.ts
- integration/broker-alpaca-adpt.resilience.integration.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/utils, event-processor, event-types
