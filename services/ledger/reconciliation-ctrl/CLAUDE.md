# reconciliation-ctrl

Domain: ledger | Bus: LedgerBus
Stack: services/ledger/reconciliation-ctrl/src/service.stack.ts

## State
- Table (DynamoDB, streams enabled)

## Ingress
- LedgerBus → reconciliation-ctrl-ingress (SQS → Lambda)
  Subscriptions: PORTFOLIO_UPDATED, PORTFOLIO_SNAPSHOT_IMPORTED, CORPORATE_ACTION_APPLIED, ALPACA_ACCOUNT_SNAPSHOT

## Egress
- CDC: DynamoDB Streams → reconciliation-ctrl-egress (Lambda)
  Emits:
    - ReconciliationResult: insert → RECONCILIATION_COMPLETED, modify → RECONCILIATION_RESULT_UPDATED
    - DriftRecord: insert → PORTFOLIO_DRIFT_DETECTED, modify → DRIFT_RECORD_UPDATED

## Handlers
- event-listener.ts — materializeToTable pipeline; reconcileHandler processes PORTFOLIO_UPDATED, PORTFOLIO_SNAPSHOT_IMPORTED, CORPORATE_ACTION_APPLIED; alpacaSnapshotHandler processes ALPACA_ACCOUNT_SNAPSHOT; writes ReconciliationResult + DriftRecord items
- event-publisher.ts — CDC changeDataCapture() pipeline

## Event Types (domain/events.ts)
- ReconciliationEventTypes: PORTFOLIO_DRIFT_DETECTED, RECONCILIATION_REQUIRED, RECONCILIATION_STARTED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, RECONCILIATION_LOCK_ACQUIRED, RECONCILIATION_LOCK_RELEASED, PROJECTION_REBUILT, CORPORATE_ACTION_APPLIED

## Tests
- event-listener.test.ts
- reconciliation.repository.test.ts
- reconciliation.service.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/extensions, event-processor
- cross-domain: @nestfolio/ledger-ctrl/events, @nestfolio/execution-adpt/domain
