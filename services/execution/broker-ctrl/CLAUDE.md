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
  Emits: NormalizedEvent

## Step Functions
- OrderStateMachine: orchestrates order lifecycle (validate → route → wait for callback)
- CircuitBreakerHealStateMachine: automatic circuit breaker recovery (emit health check → wait for adapter response)

## EventBridge Rules
- BreakerOpenTrigger: BROKER_CIRCUIT_OPEN → starts HealStateMachine

## Standalone Lambdas
- RouteOrderFn: invoked by OrderStateMachine (not via Ingress)
- EmitHealthCheckFn: invoked by HealStateMachine (not via Ingress)

## Handlers
- callback-resolver.ts
- deposit-withdrawal-normalizer.ts
- deposit-withdrawal-router.ts
- emit-health-check.ts
- event-publisher.ts
- mode-listener.ts
- route-order.ts

## Event Types (domain/events.ts)
- BrokerCtrlEventTypes (outbound/CDC): ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, ORDER_ESCALATED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, BROKER_CIRCUIT_OPEN, BROKER_CIRCUIT_CLOSED, BROKER_HEAL_ESCALATED
- BrokerCtrlRoutedEventTypes (routed to adapters): SIM_ORDER_REQUESTED, SIM_DEPOSIT_INITIATED, SIM_WITHDRAWAL_REQUESTED, ALPACA_ORDER_REQUESTED, ALPACA_ORDER_CANCEL_REQUESTED, ALPACA_TRANSFER_REQUESTED, ALPACA_ACCOUNT_CHECK
- BrokerCtrlInboundEventTypes (subscribed): ORDER_SUBMITTED, EXECUTION_MODE_CHANGED, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, SIM_ORDER_FILLED, SIM_ORDER_REJECTED, SIM_DEPOSIT_COMPLETED, SIM_WITHDRAWAL_COMPLETED, ALPACA_ORDER_FILLED, ALPACA_ORDER_PARTIALLY_FILLED, ALPACA_ORDER_REJECTED, ALPACA_ORDER_CANCELLED, ALPACA_ORDER_CANCEL_FAILED, ALPACA_TRANSFER_COMPLETED, ALPACA_TRANSFER_FAILED, ALPACA_ACCOUNT_SNAPSHOT

## Tests
- callback-resolver.test.ts
- circuit-breaker-heal.test.ts
- deposit-withdrawal-normalizer.test.ts
- deposit-withdrawal-router.test.ts
- event-publisher.test.ts
- mode-listener.test.ts
- order-normalizer.service.test.ts
- order-state-machine.test.ts
- route-order.test.ts
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/utils, cdk-constructs/extensions
