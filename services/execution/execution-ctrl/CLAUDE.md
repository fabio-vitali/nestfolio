# execution-ctrl

Domain: execution | Bus: ExecutionBus
Stack: `services/execution/execution-ctrl/src/service.stack.ts`

## State
- DynamoDB Table (streams enabled)

## Ingress
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- Ingress: ACCOUNT_CLOSURE_REQUESTED, DECISION_APPROVED, USER_CONFIRMED
<!-- /card-drift:ingress -->
- ExecutionBus -> SQS -> event-listener Lambda
  - DECISION_APPROVED (from advisory-adpt)
  - USER_CONFIRMED (from advisory-adpt)
  - ACCOUNT_CLOSURE_REQUESTED (from investor-adpt)

## Egress
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
- Order: ORDER_CREATED, ORDER_REJECTED, ORDER_STAGED, ORDER_SUBMITTED, ORDER_UPDATED
- StagedOrder: STAGED_ORDER_CREATED, STAGED_ORDER_UPDATED
<!-- /card-drift:egress -->
- DynamoDB Streams -> event-publisher Lambda (CDC)
  - Order insert: ORDER_CREATED (default), ORDER_SUBMITTED (status=SUBMITTED), ORDER_STAGED (status=STAGED), ORDER_REJECTED (status=REJECTED)
  - Order modify: ORDER_UPDATED (default), ORDER_SUBMITTED (status=SUBMITTED), ORDER_REJECTED (status=REJECTED)
  - StagedOrder insert: STAGED_ORDER_CREATED
  - StagedOrder modify: STAGED_ORDER_UPDATED

## Standalone Lambdas
- StagedOrderProcessor: scheduled via AdapterSchedule (cron 14:30 UTC MON-FRI), timeout 5min, maxRetry 2, flexibleWindow 5min
  - Reads staged orders, re-runs safety checks, submits or rejects, deletes StagedOrder records

## Handlers
<!-- card-drift:handlers (generated — `nx run event-processor:card-drift -- --fix`) -->
- staged-order-processor.ts
<!-- /card-drift:handlers -->
- `event-listener.ts` — materializeToTable pipeline, errorEventType: EXECUTION_CTRL_FAILED
- `event-publisher.ts` — changeDataCapture pipeline (typed-subject mode)
- `publisher-schemas.ts` — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt.
- `staged-order-processor.ts` — standalone scheduled Lambda (not event-processor pipeline)

## Read model
- ReadModelOwnership registered in src/read-model-ownership.ts
  - CommandOwned (mutable aggregates created via record(); mutated/deleted by StagedOrderProcessor): Order, StagedOrder
- Enforced by `nx run execution-ctrl:typecheck` (test/types/read-model-ownership.type-test.ts)

## Event Types (`domain/events.ts`)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- ExecutionCtrlEventTypes: EXECUTION_PAUSED, EXECUTION_RESUMED, ORDER_CREATED, ORDER_REJECTED, ORDER_STAGED, ORDER_SUBMITTED, ORDER_UPDATED, STAGED_ORDER_CREATED, STAGED_ORDER_UPDATED
<!-- /card-drift:event-types -->
- ORDER_CREATED, ORDER_UPDATED, ORDER_REJECTED, ORDER_SUBMITTED, ORDER_STAGED
- EXECUTION_PAUSED, EXECUTION_RESUMED
- STAGED_ORDER_CREATED, STAGED_ORDER_UPDATED

## Event Payload Contracts (domain/contracts.ts → @nestfolio/execution-ctrl/contracts)
Producer-owned zod CDC subject contracts, exported via `@nestfolio/execution-ctrl/contracts` (NOT re-exported through the `/domain` barrel). DRY domain subjects — identity travels in the event context (RequestContext), not on the subject.
- OrderSchema / Order — ORDER_CREATED / ORDER_SUBMITTED / ORDER_STAGED / ORDER_REJECTED / ORDER_UPDATED subject (the `Order` row, sk='Order'). Fields: orderId, decisionPacketId, proposedTrades (array — typed loosely as z.unknown() until the Advisory slice converts ProposedTrade to zod), status (SUBMITTED|STAGED|REJECTED|PENDING), reason?, sourceEventId?, timestamp.
- StagedOrderSchema / StagedOrder — STAGED_ORDER_CREATED / STAGED_ORDER_UPDATED subject (the `StagedOrder` row, sk='StagedOrder'). Fields: orderId, proposedTrades (array — z.unknown(), same loose typing), stagedAt, timestamp.

## Tests
### Unit (`test/unit/`)
- event-listener.test.ts
- market-hours.service.test.ts
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

## DDB Entities
<!-- card-drift:ddb-entities (generated — `nx run event-processor:card-drift -- --fix`) -->
- Order
- StagedOrder
<!-- /card-drift:ddb-entities -->
