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
  Emits: ReconciliationResult, DriftRecord

## Handlers
- event-listener.ts
- event-publisher.ts

## Event Types (domain/events.ts)
- ReconciliationEventTypes: PORTFOLIO_DRIFT_DETECTED, RECONCILIATION_REQUIRED, RECONCILIATION_STARTED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, RECONCILIATION_LOCK_ACQUIRED, RECONCILIATION_LOCK_RELEASED, PROJECTION_REBUILT, CORPORATE_ACTION_APPLIED

## Tests
- event-listener.test.ts
- event-publisher.test.ts
- reconciliation.repository.test.ts
- reconciliation.service.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/extensions
