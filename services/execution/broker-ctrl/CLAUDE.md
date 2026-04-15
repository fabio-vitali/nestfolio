# broker-ctrl

Domain: execution | Bus: ExecutionBus
Stack: services/execution/broker-ctrl/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- ExecutionBus -> broker-ctrl-mode-ingress (SQS -> Lambda)
  Subscriptions: EXECUTION_MODE_CHANGED
  Handler: handlers/mode-listener.ts

- ExecutionBus -> broker-ctrl-callback-ingress (SQS -> Lambda)
  Subscriptions: SIM_ORDER_FILLED, SIM_ORDER_REJECTED, ALPACA_ORDER_FILLED, ALPACA_ORDER_PARTIALLY_FILLED, ALPACA_ORDER_REJECTED, ALPACA_ORDER_CANCELLED, ALPACA_ORDER_CANCEL_FAILED
  Handler: handlers/callback-resolver.ts

- ExecutionBus -> broker-ctrl-deposit-withdrawal-ingress (SQS -> Lambda)
  Subscriptions: DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED
  Handler: handlers/deposit-withdrawal-router.ts

- ExecutionBus -> broker-ctrl-deposit-withdrawal-normalizer-ingress (SQS -> Lambda)
  Subscriptions: SIM_DEPOSIT_COMPLETED, SIM_WITHDRAWAL_COMPLETED, ALPACA_TRANSFER_COMPLETED, ALPACA_TRANSFER_FAILED
  Handler: handlers/deposit-withdrawal-normalizer.ts

## Egress
- CDC: DynamoDB Streams -> broker-ctrl-egress (Lambda)
  Emits:
  - NormalizedEvent (insert): passthrough on `sk` field — ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, ORDER_ESCALATED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, TRANSFER_FAILED

## Orchestration
- OrderStateMachine: orchestrates order lifecycle (ReadExecutionMode -> RouteOrder -> ClassifyResult)
  - Triggers: ORDER_SUBMITTED
  - Timeout: 1 hour
  - grantCallbackAccess -> CallbackIngress handler
  - SF role grants: eventBus PutEvents, routeOrderFn Invoke

## Standalone Lambdas
- RouteOrderFn: routes order to sim or alpaca adapter (invoked by OrderStateMachine, not via Ingress)
  - Grants: table ReadWrite, eventBus PutEvents

## Facade
- None

## Handlers
- callback-resolver.ts — resolves SF task token callbacks from adapter results (createIngestionHandler)
- deposit-withdrawal-normalizer.ts — normalizes deposit/withdrawal results to NormalizedEvent for CDC (materializeToTable)
- deposit-withdrawal-router.ts — routes deposit/withdrawal to correct adapter (createIngestionHandler)
- event-publisher.ts — CDC Egress handler (changeDataCapture)
- mode-listener.ts — caches execution mode changes to DynamoDB (materializeToTable)
- route-order.ts — routes order to correct adapter, writes BrokerOrder with taskToken (standalone, SF-invoked)

## Event Types (domain/events.ts)
- BrokerCtrlEventTypes (outbound/CDC): ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, ORDER_ESCALATED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, TRANSFER_FAILED
- BrokerCtrlRoutedEventTypes (routed to adapters): SIM_ORDER_REQUESTED, SIM_DEPOSIT_INITIATED, SIM_WITHDRAWAL_REQUESTED, ALPACA_ORDER_REQUESTED, ALPACA_ORDER_CANCEL_REQUESTED, ALPACA_TRANSFER_REQUESTED, ALPACA_ACCOUNT_CHECK
- BrokerCtrlInboundEventTypes (subscribed): ORDER_SUBMITTED, EXECUTION_MODE_CHANGED, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, SIM_ORDER_FILLED, SIM_ORDER_REJECTED, SIM_DEPOSIT_COMPLETED, SIM_WITHDRAWAL_COMPLETED, ALPACA_ORDER_FILLED, ALPACA_ORDER_PARTIALLY_FILLED, ALPACA_ORDER_REJECTED, ALPACA_ORDER_CANCELLED, ALPACA_ORDER_CANCEL_FAILED, ALPACA_TRANSFER_COMPLETED, ALPACA_TRANSFER_FAILED

## Tests
- broker-order.repository.test.ts
- callback-resolver.test.ts
- deposit-withdrawal-normalizer.test.ts
- deposit-withdrawal-router.test.ts
- execution-mode.repository.test.ts
- mode-listener.test.ts
- order-lifecycle.test.ts
- route-order.test.ts
- service.stack.test.ts
- integration/broker-ctrl.integration.test.ts
- integration/broker-ctrl.resilience.integration.test.ts

## Dependencies
- @nestfolio/cdk-constructs/core, @nestfolio/cdk-constructs/utils
- @nestfolio/event-processor
- @nestfolio/event-types
- @nestfolio/test-support (test only)
- @nestfolio/integration-testing (test only)
