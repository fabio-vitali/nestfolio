# broker-ctrl

Domain: execution | Bus: ExecutionBus
Stack: services/execution/broker-ctrl/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Read model (ownership)
- ReadModelOwnership registered in `src/read-model-ownership.ts` (WS-D), side-effect-imported from `handlers/mode-listener.ts`:
  - CommandOwned: `ExecutionMode` — single-field operating-mode cache, seeded/refreshed via `record()` on EXECUTION_MODE_CHANGED, read by the order state-machine's ReadExecutionMode GetItem. No `__version` (add one only if a P1 consumer of the cache appears). `projectVersioned()` fails typecheck.
- Enforced by `nx run broker-ctrl:typecheck` (`test/types/read-model-ownership.type-test.ts`) + the mandatory `event-processor:read-model-drift` gate. `FundingEvent` is an excluded CDC carrier (`tools/read-model-exclusions.json`).

## Ingress
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- CallbackIngress (callback-resolver.ts): ALPACA_ORDER_CANCELLED, ALPACA_ORDER_CANCEL_FAILED, ALPACA_ORDER_FILLED, ALPACA_ORDER_PARTIALLY_FILLED, ALPACA_ORDER_REJECTED, SIM_ORDER_FILLED, SIM_ORDER_REJECTED
- DepositWithdrawalIngress (deposit-withdrawal-router.ts): DEPOSIT_INITIATED, WITHDRAWAL_INITIATED
- DepositWithdrawalNormalizerIngress (deposit-withdrawal-normalizer.ts): ALPACA_TRANSFER_COMPLETED, ALPACA_TRANSFER_FAILED, SIM_DEPOSIT_COMPLETED, SIM_WITHDRAWAL_COMPLETED
- ModeIngress (mode-listener.ts): EXECUTION_MODE_CHANGED
<!-- /card-drift:ingress -->

## Egress
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
- FundingEvent: DEPOSIT_DETECTED, DEPOSIT_FAILED, DEPOSIT_REQUESTED, DEPOSIT_SETTLED, WITHDRAWAL_FAILED, WITHDRAWAL_REQUESTED, WITHDRAWAL_SETTLED
- NormalizedEvent: ORDER_CANCELLED, ORDER_ESCALATED, ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED
<!-- /card-drift:egress -->
- CDC: DynamoDB Streams -> broker-ctrl-egress (Lambda)

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
<!-- card-drift:handlers (generated — `nx run event-processor:card-drift -- --fix`) -->
- callback-resolver.ts
- deposit-withdrawal-normalizer.ts
- deposit-withdrawal-router.ts
- mode-listener.ts
- route-order.ts
<!-- /card-drift:handlers -->
- callback-resolver.ts — resolves SF task token callbacks from adapter results (createIngestionHandler)
- deposit-withdrawal-normalizer.ts — normalizes deposit/withdrawal results to NormalizedEvent for CDC (materializeToTable); parseSubject per producer: SimDepositCompletedSchema/SimWithdrawalCompletedSchema from `@nestfolio/broker-sim-adpt/contracts`, AlpacaTransferResultSchema from `@nestfolio/execution-adpt/domain`; keys carryForward on the threaded nestfolioTransferId; zero `as Record<string,unknown>` casts
- deposit-withdrawal-router.ts — routes deposit/withdrawal to correct adapter; validates inbound subjects via `parseSubject` against producer contracts `DepositInitiatedSchema`/`WithdrawalInitiatedSchema` from `@nestfolio/investor-adpt/domain`; live branch emits typed `AlpacaTransferRequest` (from `@nestfolio/execution-adpt/domain`) threading transferId=depositId/withdrawalId (materializeToTable)
- event-publisher.ts — CDC Egress handler (changeDataCapture, typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt.
- mode-listener.ts — caches execution mode changes to DynamoDB (materializeToTable)
- route-order.ts — routes order to correct adapter, writes BrokerOrder with taskToken (standalone, SF-invoked)

## Event Types (domain/events.ts)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- BrokerCtrlEventTypes: DEPOSIT_DETECTED, DEPOSIT_FAILED, DEPOSIT_REQUESTED, DEPOSIT_SETTLED, ORDER_CANCELLED, ORDER_ESCALATED, ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, WITHDRAWAL_FAILED, WITHDRAWAL_REQUESTED, WITHDRAWAL_SETTLED
- BrokerCtrlInboundEventTypes: ALPACA_ORDER_CANCEL_FAILED, ALPACA_ORDER_CANCELLED, ALPACA_ORDER_FILLED, ALPACA_ORDER_PARTIALLY_FILLED, ALPACA_ORDER_REJECTED, ALPACA_TRANSFER_COMPLETED, ALPACA_TRANSFER_FAILED, DEPOSIT_INITIATED, EXECUTION_MODE_CHANGED, ORDER_SUBMITTED, SIM_DEPOSIT_COMPLETED, SIM_ORDER_FILLED, SIM_ORDER_REJECTED, SIM_WITHDRAWAL_COMPLETED, WITHDRAWAL_INITIATED
- BrokerCtrlRoutedEventTypes: ALPACA_ACCOUNT_CHECK, ALPACA_ORDER_CANCEL_REQUESTED, ALPACA_ORDER_REQUESTED, ALPACA_TRANSFER_REQUESTED, SIM_DEPOSIT_INITIATED, SIM_ORDER_REQUESTED, SIM_WITHDRAWAL_REQUESTED
<!-- /card-drift:event-types -->

## Event Payload Contracts (domain/contracts.ts → @nestfolio/broker-ctrl/contracts)
Producer-owned zod CDC subject contracts, exported via `@nestfolio/broker-ctrl/contracts` (NOT re-exported through the `/domain` barrel). DRY domain subjects — identity travels in the event context (RequestContext), not on the subject.
- NormalizedOrderEventSchema / NormalizedOrderEvent — ORDER_FILLED / ORDER_PARTIALLY_FILLED / ORDER_REJECTED / ORDER_CANCELLED / ORDER_ESCALATED subject (the `NormalizedEvent` row, sk passthrough). Fields: orderId, executionMode, filledQty?, averageFillPrice?, failureReason?, timestamp. (The old `NormalizedEvent` row schema in domain/schemas.ts was removed — row schema → dry contract.)
- BrokerOrderSchema / BrokerOrder — internal BrokerOrder state row (sk='BrokerOrder'), NOT CDC-emitted. Tenant-scoped mutable order-routing state. Fields: orderId, executionMode, state (ROUTING/AWAITING_FILL/FILLED/PARTIALLY_FILLED/REJECTED/CANCELLED/ESCALATED), routedTo (sim|alpaca), fillTaskToken?, requestedQty, filledQty, remainingQty, averageFillPrice?, retryCount, instrumentId, routedAt, filledAt?, failureReason?.
- ExecutionModeSchema / ExecutionMode — internal ExecutionMode cache row (sk='ExecutionMode'), NOT CDC-emitted. CommandOwned, single per-tenant operating-mode cache. Fields: mode (simulation|live), updatedAt.
- Also exported: `brokerCtrlEventSubjects` — test-fixture event→subject map (ALPACA_ORDER_REQUESTED/SIM_ORDER_REQUESTED → BrokerOrderRequestSchema, ALPACA_TRANSFER_REQUESTED → AlpacaTransferRequestSchema, SIM_DEPOSIT_INITIATED/SIM_WITHDRAWAL_REQUESTED → their subject schemas, DEPOSIT_SETTLED/WITHDRAWAL_SETTLED → FundingSnapshotSchema, ORDER_FILLED/ORDER_PARTIALLY_FILLED/ORDER_REJECTED/ORDER_CANCELLED/ORDER_ESCALATED → NormalizedOrderEventSchema) consumed only by `@nestfolio/test-contracts` for typed test fixtures. Not a runtime contract; tree-shaken from Lambda bundles. (DEPOSIT/WITHDRAWAL_SETTLED added by typed-test-fixtures-cross-domain-consumer-migration; ORDER_* added by typed-test-fixtures-cross-domain-order-events.)

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
- @nestfolio/investor-adpt/domain — consumes producer contracts `DepositInitiatedSchema`, `WithdrawalInitiatedSchema` (router `parseSubject` seam)
- @nestfolio/execution-adpt/domain — consumes `FundingSnapshot` (funding carrier shape; `fundingCarrier` writes `satisfies Omit<FundingSnapshot, '__version'>`); `AlpacaTransferRequest` (router emits typed transfer request); `AlpacaTransferResultSchema` (normalizer `parseSubject` seam for ALPACA_TRANSFER_* events)
- @nestfolio/broker-sim-adpt/contracts — consumes `SimDepositCompletedSchema`, `SimWithdrawalCompletedSchema` (normalizer `parseSubject` seam for SIM_DEPOSIT_COMPLETED / SIM_WITHDRAWAL_COMPLETED)
- @nestfolio/test-support (test only)
- @nestfolio/integration-testing (test only)

## DDB Entities
<!-- card-drift:ddb-entities (generated — `nx run event-processor:card-drift -- --fix`) -->
- ExecutionMode
- FundingEvent
- NormalizedEvent
<!-- /card-drift:ddb-entities -->
