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
  Emits: Order, StagedOrder

## Scheduled
- MarketOpenSchedule: staged-order-processor runs at US market open (cron 14:30 UTC, MON-FRI)

## Handlers
- event-listener.ts
- event-publisher.ts
- staged-order-processor.ts

## Tests
- event-listener.test.ts
- event-publisher.test.ts
- staged-order-processor.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/extensions, cdk-constructs/utils
