# execution-hub

Domain: execution | Bus: ExecutionBus
Stack: services/execution/execution-hub/src/service.stack.ts

## State
None (stateless hub)

## Infrastructure
- ExecutionBus (EventBridge) — domain event bus
- Archive: 365-day event replay
- SharedParameter: bus ARN published to SSM
- CrossAccountBusPolicy: cross-account PutEvents (when multi-account)
- Monitoring + ServiceDashboard

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
