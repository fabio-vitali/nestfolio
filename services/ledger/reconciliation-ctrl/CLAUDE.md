# reconciliation-ctrl

Domain: ledger | Bus: LedgerBus
Stack: services/ledger/reconciliation-ctrl/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Read model (ownership)
- ReadModelOwnership registered in `src/read-model-ownership.ts` (WS-D), side-effect-imported from `handlers/event-listener.ts`:
  - CommandOwned: `ReconciliationResult`, `DriftRecord` — computed by `reconcile()`, written via `record()`, read back via `getDriftRecords` (read-your-own-writes). No other service projects the rows; consumers react to the emitted RECONCILIATION_COMPLETED / PORTFOLIO_DRIFT_DETECTED events. `projectVersioned()` fails typecheck.
- Enforced by `nx run reconciliation-ctrl:typecheck` (`test/types/read-model-ownership.type-test.ts`) + the mandatory `event-processor:read-model-drift` gate.

## Ingress
<!-- card-drift:ingress (generated — `nx run event-processor:card-drift -- --fix`) -->
- Ingress: ALPACA_ACCOUNT_SNAPSHOT, CORPORATE_ACTION_APPLIED, PORTFOLIO_SNAPSHOT_IMPORTED, PORTFOLIO_UPDATED
<!-- /card-drift:ingress -->
- LedgerBus → reconciliation-ctrl-ingress (SQS → Lambda)

## Egress
<!-- card-drift:egress (generated — `nx run event-processor:card-drift -- --fix`) -->
- DriftRecord: DRIFT_RECORD_UPDATED, PORTFOLIO_DRIFT_DETECTED
- ReconciliationResult: RECONCILIATION_COMPLETED, RECONCILIATION_RESULT_UPDATED
<!-- /card-drift:egress -->
- CDC: DynamoDB Streams → reconciliation-ctrl-egress (Lambda)

## Contracts (domain/contracts.ts → @nestfolio/reconciliation-ctrl/contracts)
Producer-owned zod payload contracts for the 2 CDC-emitted rows (imports ONLY zod). Dry subjects — identity travels in the event context (RequestContext), not on the subject.
- ReconciliationResultSchema — RECONCILIATION_COMPLETED / RECONCILIATION_RESULT_UPDATED subject
- DriftRecordSchema — PORTFOLIO_DRIFT_DETECTED / DRIFT_RECORD_UPDATED subject
- The other declared event names are consumed-only (CORPORATE_ACTION_APPLIED) or declared-but-unused — no contracts (not emitted).

## Handlers
- event-listener.ts — materializeToTable pipeline; reconcileHandler processes PORTFOLIO_UPDATED, PORTFOLIO_SNAPSHOT_IMPORTED, CORPORATE_ACTION_APPLIED; alpacaSnapshotHandler processes ALPACA_ACCOUNT_SNAPSHOT; writes ReconciliationResult + DriftRecord items
- event-publisher.ts — CDC changeDataCapture() pipeline (typed-subject mode)
- publisher-schemas.ts — typed-subject registry: maps each emitted __typename → its producer zod contract (subjectSchemas) + exemptTypenames; the publisher emits schema.parse(row) (the DRY subject) for covered types, the fat row for exempt.

## Event Types (domain/events.ts)
<!-- card-drift:event-types (generated — `nx run event-processor:card-drift -- --fix`) -->
- ReconciliationEventTypes: CORPORATE_ACTION_APPLIED, DRIFT_RECORD_UPDATED, PORTFOLIO_DRIFT_DETECTED, PROJECTION_REBUILT, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, RECONCILIATION_LOCK_ACQUIRED, RECONCILIATION_LOCK_RELEASED, RECONCILIATION_REQUIRED, RECONCILIATION_RESULT_UPDATED, RECONCILIATION_STARTED
<!-- /card-drift:event-types -->

## Tests
- domain/contracts.test.ts
- event-listener.test.ts
- reconciliation.repository.test.ts
- reconciliation.service.test.ts
- integration/reconciliation-ctrl.integration.test.ts
- integration/reconciliation-ctrl.resilience.integration.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/extensions, event-processor
- cross-domain: @nestfolio/ledger-ctrl/events, @nestfolio/execution-adpt/domain

## DDB Entities
<!-- card-drift:ddb-entities (generated — `nx run event-processor:card-drift -- --fix`) -->
- DriftRecord
- ReconciliationResult
<!-- /card-drift:ddb-entities -->
