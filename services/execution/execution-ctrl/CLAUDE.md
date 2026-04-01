# execution-ctrl

Domain: execution | Bus: ExecutionBus
Stack: services/execution/execution-ctrl/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- ExecutionBus → execution-ctrl-ingress (SQS → Lambda)
  Subscriptions: DECISION_APPROVED, USER_CONFIRMED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, ACCOUNT_CLOSURE_REQUESTED

## Egress
- CDC: DynamoDB Streams → execution-ctrl-egress (Lambda)
  Emits:
  - Order (insert): ORDER_SUBMITTED (default), ORDER_STAGED (status=STAGED), ORDER_REJECTED (status=REJECTED)
  - Order (modify): ORDER_UPDATED (default), ORDER_SUBMITTED (status=SUBMITTED), ORDER_REJECTED (status=REJECTED)
  - StagedOrder (insert): STAGED_ORDER

## Scheduled
- MarketOpenSchedule: staged-order-processor runs at US market open (cron 14:30 UTC, MON-FRI)
  - Target: StagedOrderProcessor Lambda
  - Timeout: 5 min
  - Max retries: 2, flexible window: 5 min

## Handlers
- event-listener.ts — SQS Ingress handler (event-processor pipeline)
- event-publisher.ts — CDC Egress handler (event-processor pipeline)
- staged-order-processor.ts — scheduled Lambda, processes staged orders at market open

## Event Types (domain/events.ts)
- ExecutionCtrlEventTypes: ORDER_SUBMITTED, ORDER_STAGED, EXECUTION_PAUSED, EXECUTION_RESUMED

## Tests
- event-listener.test.ts
- market-hours.service.test.ts
- order-lifecycle.service.test.ts
- order.repository.test.ts
- safety-checks.service.test.ts
- staged-order-processor.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/extensions, cdk-constructs/utils, event-processor
- cross-domain types: advisory-adpt/domain, investor-adpt/domain
