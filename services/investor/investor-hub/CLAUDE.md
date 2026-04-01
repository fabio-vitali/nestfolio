# investor-hub

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-hub/src/service.stack.ts

## State
None (stateless hub)

## Infrastructure
- InvestorBus (EventBridge) — domain event bus
- Archive: 365-day event replay
- SharedParameter: bus ARN published to SSM at {prefix}/investor-hub/event-hub/busArn
- CrossAccountBusPolicy: cross-account PutEvents (when consumerAccountIds > 0)
- CostControls: budget alerts ($200/month threshold, email from context alertEmail)
- Monitoring: DLQ + EventBus metrics
- ServiceDashboard: investor-hub dashboard

## Tests
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/observability, cdk-constructs/extensions
