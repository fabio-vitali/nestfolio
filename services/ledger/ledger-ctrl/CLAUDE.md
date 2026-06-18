# ledger-ctrl

Domain: ledger | Bus: ledgerBus
Stack: services/ledger/ledger-ctrl/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- Ingress: CORPORATE_ACTION_APPLIED, DECISION_PACKET_CREATED, DEPOSIT_SETTLED, ORDER_CANCELLED, ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, WITHDRAWAL_SETTLED
<!-- /card-drift:ingress -->
- ledgerBus → ledger-ctrl-ingress (SQS → Lambda)

## Egress
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
- BalanceEvent: BALANCE_EVENT_UPDATED, BALANCE_UPDATED
- LedgerEntryEvent: LEDGER_ENTRY_EVENT_UPDATED, LEDGER_ENTRY_RECORDED
- PortfolioEvent: PORTFOLIO_EVENT_UPDATED, PORTFOLIO_UPDATED
<!-- /card-drift:egress -->
- CDC: DynamoDB Streams → ledger-ctrl-egress (Lambda)

## Standalone Lambdas
- ReducerFn: DDB Stream consumer that materializes account snapshots
  Filter: INSERT events where __typename = 'LedgerEntry'
  Batch: 100 records, 5s window, bisect on error, 3 retries

## Handlers
<!-- card-drift:handlers (generated — `nx run event-processor:card-drift -- --fix`) -->
- reducer.ts
- snapshot-publisher.ts
<!-- /card-drift:handlers -->
- event-listener.ts — Ingress event handler
- event-publisher.ts — Egress CDC publisher (changeDataCapture pipeline, typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt.
- reducer.ts — Account snapshot materializer (DDB Stream consumer)
- snapshot-publisher.ts — deriveFromStream pipeline; filters AccountSnapshot records, transforms to domain events via snapshotToEvents (transforms/snapshot-to-events.ts — emits BalanceEvent/PortfolioEvent/LedgerEntryEvent[+snapshotAt]/SnapshotHistory; errorEventType LEDGER_SNAPSHOT_PUBLISHER_FAILED)

## Event Types (domain/events.ts)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- LedgerCtrlEventTypes: BALANCE_EVENT_UPDATED, BALANCE_UPDATED, LEDGER_ENTRY_EVENT_UPDATED, LEDGER_ENTRY_RECORDED, LEDGER_PROCESSING_FAILED, LEDGER_SIMULATION_FAILED, PORTFOLIO_EVENT_UPDATED, PORTFOLIO_UPDATED
<!-- /card-drift:event-types -->

## Contracts (domain/contracts.ts → @nestfolio/ledger-ctrl/contracts)
Producer-owned zod payload contracts for the CDC-published subjects (imports ONLY zod). Consumers parse via these schemas — payload changes break consumer builds. DRY domain subjects — identity travels in the event context (RequestContext), not on the subject.
- LedgerPositionSchema / LedgerSnapshotSchema — shared snapshot shape wrapped on every ledger event
- BalanceUpdatedSchema — BALANCE_UPDATED subject (BalanceEvent record)
- PortfolioUpdatedSchema — PORTFOLIO_UPDATED subject (PortfolioEvent record)
- LedgerEntryRecordedSchema — LEDGER_ENTRY_RECORDED subject (carries snapshotAt)
- AccountSnapshotSchema — the persisted `Snapshot#latest` row aggregate that the reducer materializes; the source `SnapshotRecord` the CDC transform reads. Not directly CDC-emitted; its fields flow out via the three event schemas above.
- TaxLotSchema — tax-lot aggregate (FIFO cost-basis tracking). The persisted row is typed as `TaxLotEntry = TableEntry<TaxLot, { tenantId: string }> & { __typename: 'TaxLot' }` (defined in `ledger.repository.ts`).
- SnapshotHistorySchema — internal append-only snapshot-history aggregate (TTL'd). Not CDC-emitted; never reaches the egress pipeline.
- Failure events (LEDGER_PROCESSING_FAILED, LEDGER_SNAPSHOT_PUBLISHER_FAILED) use the shared @nestfolio/event-processor `ErrorEventSubjectSchema` (platform contract, not a producer aggregate).
- Persisted rows are typed via `TableEntry<Subject>`: `TaxLotEntry = TableEntry<TaxLot, { tenantId: string }>` (repository) and `SnapshotRecord = TableEntry<AccountSnapshot, RequestContext>` (transforms/snapshot-to-events.ts) — no hand-rolled pk/sk/__typename interfaces.
- Cross-domain consumers: ledger-bff, investor-bff, dashboard-bff, decision-workflow-ctrl
- Also exported: @nestfolio/ledger-ctrl/events (LedgerCtrlEventTypes)
- Also exported: `ledgerCtrlEventSubjects` — test-fixture event→subject map (BALANCE_UPDATED→BalanceUpdatedSchema, PORTFOLIO_UPDATED→PortfolioUpdatedSchema, LEDGER_ENTRY_RECORDED→LedgerEntryRecordedSchema) consumed only by `@nestfolio/test-contracts` for typed test fixtures (typed-test-fixtures Phase 4). Not a runtime contract; tree-shaken from Lambda bundles.

## Tests
- domain/account-state.test.ts
- domain/account.reducer.test.ts
- domain/cancel-order.test.ts
- domain/contracts.test.ts
- domain/record-corporate-action.test.ts
- domain/record-deposit.test.ts
- domain/record-fill.test.ts
- domain/record-withdrawal.test.ts
- domain/submit-order.test.ts
- handlers/event-listener.test.ts
- handlers/reducer.test.ts
- handlers/snapshot-publisher.test.ts
- repositories/ledger.repository.test.ts
- service.stack.test.ts
- tax-lot-manager.test.ts
- transforms/snapshot-to-events.test.ts
- integration/ledger-ctrl.integration.test.ts
- integration/ledger-ctrl.resilience.integration.test.ts

## Dependencies
- libs: cdk-constructs (core, extensions, utils), event-processor, event-processor/sourcing

## DDB Entities
<!-- card-drift:ddb-entities (generated — `nx run event-processor:card-drift -- --fix`) -->
- BalanceEvent
- LedgerEntryEvent
- PortfolioEvent
- SnapshotHistory
<!-- /card-drift:ddb-entities -->
