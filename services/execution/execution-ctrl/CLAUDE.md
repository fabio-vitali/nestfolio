# execution-ctrl

Domain: execution | Bus: ExecutionBus
Stack: `services/execution/execution-ctrl/src/service.stack.ts`

## State
- DynamoDB Table (streams enabled)

## Ingress
- ExecutionBus -> SQS -> event-listener Lambda
  - DECISION_APPROVED (from advisory-adpt)
  - USER_CONFIRMED (from advisory-adpt)
  - ACCOUNT_CLOSURE_REQUESTED (from investor-adpt)

## Egress
- DynamoDB Streams -> event-publisher Lambda (CDC)
  - Order insert: ORDER_CREATED (default), ORDER_SUBMITTED (status=SUBMITTED), ORDER_STAGED (status=STAGED), ORDER_REJECTED (status=REJECTED)
  - Order modify: ORDER_UPDATED (default), ORDER_SUBMITTED (status=SUBMITTED), ORDER_REJECTED (status=REJECTED)
  - StagedOrder insert: STAGED_ORDER_CREATED
  - StagedOrder modify: STAGED_ORDER_UPDATED

## Standalone Lambdas
- StagedOrderProcessor: scheduled via AdapterSchedule (cron 14:30 UTC MON-FRI), timeout 5min, maxRetry 2, flexibleWindow 5min
  - Reads staged orders, re-runs safety checks, submits or rejects, deletes StagedOrder records

## Handlers
- `event-listener.ts` — materializeToTable pipeline, errorEventType: EXECUTION_CTRL_FAILED
- `event-publisher.ts` — changeDataCapture pipeline
- `staged-order-processor.ts` — standalone scheduled Lambda (not event-processor pipeline)

## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - CommandOwned (mutable aggregates created via record(); mutated/deleted by StagedOrderProcessor): Order, StagedOrder
- Enforced by `nx run execution-ctrl:typecheck` (test/types/read-model-ownership.type-test.ts)

## Event Types (`domain/events.ts`)
- ORDER_CREATED, ORDER_UPDATED, ORDER_REJECTED, ORDER_SUBMITTED, ORDER_STAGED
- EXECUTION_PAUSED, EXECUTION_RESUMED
- STAGED_ORDER_CREATED, STAGED_ORDER_UPDATED

## Tests
### Unit (`test/unit/`)
- event-listener.test.ts
- market-hours.service.test.ts
- order-lifecycle.service.test.ts
- order.repository.test.ts
- safety-checks.service.test.ts
- staged-order-processor.test.ts

### Integration (`test/integration/`)
- execution-ctrl.integration.test.ts
- execution-ctrl.resilience.integration.test.ts

## Dependencies
- `@nestfolio/cdk-constructs/core` (ServiceStack, State, Ingress, Egress)
- `@nestfolio/cdk-constructs/extensions` (AdapterSchedule)
- `@nestfolio/cdk-constructs/utils` (defaultLambdaProps)
- `@nestfolio/event-processor`
- `@nestfolio/event-types`
- `@nestfolio/advisory-adpt/domain` (cross-domain event types + ProposedTrade)
- `@nestfolio/investor-adpt/domain` (cross-domain event types)
- `@nestfolio/execution-adpt/domain` (ExecutionIngestEventTypes)
