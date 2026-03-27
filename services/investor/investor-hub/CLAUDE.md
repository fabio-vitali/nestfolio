# investor-hub

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-hub/src/service.stack.ts

## State
None (stateProps: false)

## Infrastructure
- InvestorBus (EventBridge) — domain event bus
- Archive: 365-day event replay
- SharedParameter: bus ARN published to SSM
- CrossAccountBusPolicy: cross-account PutEvents (when multi-account)
- CostControls: budget alerts ($200/month threshold)
- Monitoring + ServiceDashboard

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
