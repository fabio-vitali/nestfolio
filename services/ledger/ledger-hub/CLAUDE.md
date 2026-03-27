# ledger-hub

Domain: ledger | Bus: LedgerBus
Stack: services/ledger/ledger-hub/src/service.stack.ts

## State
None (stateProps: false)

## Infrastructure
- LedgerBus (EventBridge) — domain event bus
- Archive: 365-day event replay
- SharedParameter: bus ARN published to SSM
- CrossAccountBusPolicy: cross-account PutEvents (when multi-account)
- Monitoring + ServiceDashboard

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
