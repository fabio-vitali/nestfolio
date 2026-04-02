# broker-ctrl

Domain: execution | Bus: ExecutionBus
Stack: services/execution/broker-ctrl/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- ExecutionBus → broker-ctrl-mode-ingress (SQS → Lambda)
  Subscriptions: EXECUTION_MODE_CHANGED
  Handler: handlers/mode-listener.ts

- ExecutionBus → broker-ctrl-callback-ingress (SQS → Lambda)
  Subscriptions: SIM_ORDER_FILLED, SIM_ORDER_REJECTED, ALPACA_ORDER_FILLED, ALPACA_ORDER_PARTIALLY_FILLED, ALPACA_ORDER_REJECTED, ALPACA_ORDER_CANCELLED, ALPACA_ORDER_CANCEL_FAILED, ALPACA_ACCOUNT_SNAPSHOT
  Handler: handlers/callback-resolver.ts

- ExecutionBus → broker-ctrl-deposit-withdrawal-ingress (SQS → Lambda)
  Subscriptions: DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED
  Handler: handlers/deposit-withdrawal-router.ts

- ExecutionBus → broker-ctrl-deposit-withdrawal-normalizer-ingress (SQS → Lambda)
  Subscriptions: SIM_DEPOSIT_COMPLETED, SIM_WITHDRAWAL_COMPLETED, ALPACA_TRANSFER_COMPLETED, ALPACA_TRANSFER_FAILED
  Handler: handlers/deposit-withdrawal-normalizer.ts

## Egress
- CDC: DynamoDB Streams → broker-ctrl-egress (Lambda)
  Emits:
  - NormalizedEvent (insert): passthrough on `sk` field — ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, ORDER_ESCALATED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED, TRANSFER_FAILED

## Orchestration
- OrderStateMachine: orchestrates order lifecycle (validate → route → wait for callback)
  - Triggers: ORDER_SUBMITTED
  - Timeout: 1 hour
  - grantCallbackAccess → CallbackIngress handler
  - SF role grants: eventBus PutEvents, routeOrderFn Invoke

- HealStateMachine: automatic circuit breaker recovery (emit health check → wait for adapter response)
  - Triggers: BROKER_CIRCUIT_OPEN
  - Timeout: 2 hours
  - grantCallbackAccess → CallbackIngress handler (env: HEAL_STATE_MACHINE_ARN)
  - SF role grants: emitHealthCheckFn Invoke

## Standalone Lambdas
- RouteOrderFn: routes order to sim or alpaca adapter (invoked by OrderStateMachine, not via Ingress)
- EmitHealthCheckFn: emits health check event to bus (invoked by HealStateMachine, not via Ingress)

## Handlers
- callback-resolver.ts — resolves SF task token callbacks from adapter results
- deposit-withdrawal-normalizer.ts — normalizes deposit/withdrawal results to NormalizedEvent for CDC
- deposit-withdrawal-router.ts — routes deposit/withdrawal to correct adapter
- emit-health-check.ts — emits health check event (standalone, SF-invoked)
- event-publisher.ts — CDC Egress handler (event-processor pipeline)
- mode-listener.ts — caches execution mode changes to DynamoDB
- route-order.ts — routes order to correct adapter (standalone, SF-invoked)

## Event Types (domain/events.ts)
- BrokerCtrlEventTypes (outbound/CDC): ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, ORDER_ESCALATED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED, TRANSFER_FAILED
- BrokerCtrlRoutedEventTypes (routed to adapters): SIM_ORDER_REQUESTED, SIM_DEPOSIT_INITIATED, SIM_WITHDRAWAL_REQUESTED, ALPACA_ORDER_REQUESTED, ALPACA_ORDER_CANCEL_REQUESTED, ALPACA_TRANSFER_REQUESTED, ALPACA_ACCOUNT_CHECK
- BrokerCtrlInboundEventTypes (subscribed): ORDER_SUBMITTED, EXECUTION_MODE_CHANGED, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, SIM_ORDER_FILLED, SIM_ORDER_REJECTED, SIM_DEPOSIT_COMPLETED, SIM_WITHDRAWAL_COMPLETED, ALPACA_ORDER_FILLED, ALPACA_ORDER_PARTIALLY_FILLED, ALPACA_ORDER_REJECTED, ALPACA_ORDER_CANCELLED, ALPACA_ORDER_CANCEL_FAILED, ALPACA_TRANSFER_COMPLETED, ALPACA_TRANSFER_FAILED, ALPACA_ACCOUNT_SNAPSHOT

## Tests
- broker-order.repository.test.ts
- callback-resolver.test.ts
- circuit-breaker.repository.test.ts
- deposit-withdrawal-normalizer.test.ts
- deposit-withdrawal-router.test.ts
- emit-health-check.test.ts
- execution-mode.repository.test.ts
- mode-listener.test.ts
- route-order.test.ts
- service.stack.test.ts
- integration/order-lifecycle.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/utils, event-processor
