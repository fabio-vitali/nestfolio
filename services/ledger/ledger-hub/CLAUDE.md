# ledger-hub

Domain: ledger | Bus: LedgerBus
Stack: services/ledger/ledger-hub/src/service.stack.ts

## State
None (stateless hub)

## Infrastructure
- LedgerBus (EventBridge) — domain event bus, name from this.naming.eventBusName()
- Archive: 365-day event replay (pattern: all sources)
- SharedParameter: bus ARN published to SSM at {prefix}/event-hub/busArn
- CrossAccountBusPolicy: cross-account PutEvents (when consumerAccountIds > 0)
- Monitoring: watches DLQs + event bus metrics
- ServiceDashboard: CloudWatch dashboard for ledger-hub

## Tests
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
