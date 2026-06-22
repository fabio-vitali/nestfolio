# execution-ctrl

Domain: execution | Bus: ExecutionBus
Stack: `services/execution/execution-ctrl/src/service.stack.ts`

## State
- DynamoDB Table (streams enabled)

## Ingress
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- Ingress: ACCOUNT_CLOSURE_REQUESTED, DECISION_APPROVED, USER_CONFIRMED
<!-- /card-drift:ingress -->

## Egress
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
- Order: ORDER_CREATED, ORDER_REJECTED, ORDER_STAGED, ORDER_SUBMITTED, ORDER_UPDATED
- StagedOrder: STAGED_ORDER_CREATED, STAGED_ORDER_UPDATED
<!-- /card-drift:egress -->
- DynamoDB Streams -> event-publisher Lambda (CDC)

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

## Event Payload Contracts (domain/contracts.ts → @nestfolio/execution-ctrl/contracts)
Producer-owned zod CDC subject contracts, exported via `@nestfolio/execution-ctrl/contracts` (NOT re-exported through the `/domain` barrel). DRY domain subjects — identity travels in the event context (RequestContext), not on the subject.

Single-symbol per row: one Order row is written per `ProposedTrade` entry in the authorizing event's `proposedTrades[]`. The event-listener expands DECISION_APPROVED / USER_CONFIRMED into N per-trade rows. `orderId = ${authorizingEventId}#${index}` — deterministic and idempotent across redeliveries.

- OrderSchema / Order — ORDER_CREATED / ORDER_SUBMITTED / ORDER_STAGED / ORDER_REJECTED / ORDER_UPDATED subject (the `Order` row, sk='Order'). Fields: orderId, decisionPacketId, symbol (string), side (BUY|SELL), quantityOrAmountCents (number), status (SUBMITTED|STAGED|REJECTED|PENDING), reason?, sourceEventId?, timestamp.
- StagedOrderSchema / StagedOrder — STAGED_ORDER_CREATED / STAGED_ORDER_UPDATED subject (the `StagedOrder` row, sk='StagedOrder'). Fields: orderId, symbol (string), side (BUY|SELL), quantityOrAmountCents (number), stagedAt, timestamp.
- Also exported: `executionCtrlEventSubjects` — test-fixture event→subject map (ORDER_SUBMITTED → OrderSchema) consumed only by `@nestfolio/test-contracts` for typed test fixtures (lets tests inject a typed ORDER_SUBMITTED to drive the real order→fill→ledger path — order-execution-money-path WS-5). Only ORDER_SUBMITTED is registered; ORDER_REJECTED/ORDER_CANCELLED are owned in the registry by broker-ctrl's NormalizedOrderEventSchema (fill-side), so registering execution-ctrl's order-creation ORDER_REJECTED would collide. Not a runtime contract; tree-shaken from Lambda bundles.

## Tests
### Unit (`test/unit/`)
- event-listener.test.ts
- market-hours.service.test.ts
- order.repository.test.ts
- publisher-schemas.test.ts
- safety-checks.service.test.ts
- staged-order-processor.test.ts
- domain/contracts.test.ts

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
