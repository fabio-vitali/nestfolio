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
- LedgerBus → reconciliation-ctrl-ingress (SQS → Lambda)
  Subscriptions: PORTFOLIO_UPDATED, PORTFOLIO_SNAPSHOT_IMPORTED, CORPORATE_ACTION_APPLIED, ALPACA_ACCOUNT_SNAPSHOT

## Egress
- CDC: DynamoDB Streams → reconciliation-ctrl-egress (Lambda)
  Emits:
    - ReconciliationResult: insert → RECONCILIATION_COMPLETED, modify → RECONCILIATION_RESULT_UPDATED
    - DriftRecord: insert → PORTFOLIO_DRIFT_DETECTED, modify → DRIFT_RECORD_UPDATED

## Contracts (domain/contracts.ts → @nestfolio/reconciliation-ctrl/contracts)
Producer-owned zod payload contracts for the 2 CDC-emitted rows (imports ONLY zod). Dry subjects — identity travels in the event context (RequestContext), not on the subject.
- ReconciliationResultSchema — RECONCILIATION_COMPLETED / RECONCILIATION_RESULT_UPDATED subject
- DriftRecordSchema — PORTFOLIO_DRIFT_DETECTED / DRIFT_RECORD_UPDATED subject
- The other declared event names are consumed-only (CORPORATE_ACTION_APPLIED) or declared-but-unused — no contracts (not emitted).

## Handlers
- event-listener.ts — materializeToTable pipeline; reconcileHandler processes PORTFOLIO_UPDATED, PORTFOLIO_SNAPSHOT_IMPORTED, CORPORATE_ACTION_APPLIED; alpacaSnapshotHandler processes ALPACA_ACCOUNT_SNAPSHOT; writes ReconciliationResult + DriftRecord items
- event-publisher.ts — CDC changeDataCapture() pipeline

## Event Types (domain/events.ts)
- ReconciliationEventTypes: PORTFOLIO_DRIFT_DETECTED, RECONCILIATION_REQUIRED, RECONCILIATION_STARTED, RECONCILIATION_COMPLETED, RECONCILIATION_RESULT_UPDATED, RECONCILIATION_FAILED, DRIFT_RECORD_UPDATED, RECONCILIATION_LOCK_ACQUIRED, RECONCILIATION_LOCK_RELEASED, PROJECTION_REBUILT, CORPORATE_ACTION_APPLIED

## Tests
- event-listener.test.ts
- reconciliation.repository.test.ts
- reconciliation.service.test.ts
- integration/reconciliation-ctrl.integration.test.ts
- integration/reconciliation-ctrl.resilience.integration.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/extensions, event-processor
- cross-domain: @nestfolio/ledger-ctrl/events, @nestfolio/execution-adpt/domain
